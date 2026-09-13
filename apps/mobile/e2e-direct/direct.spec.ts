import { test, expect } from "@playwright/test";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import { demoMe } from "../src/demo/fixtures";

test("mobile connects without cloud login and shares real daemon chat, panes and terminal sessions", async ({
  page,
}) => {
  // Exercise connection, chat, navigation, terminal and independent profile sign-in.
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-mobile-direct-project-"));
  const desktop = new DaemonConnection({
    endpoint: describeDaemonEndpoint(mobileDesktopSocket),
    client: { kind: "desktop", name: "direct-acceptance-desktop", version: "0.1.0" },
  });
  const cloudRequests: string[] = [];
  const profileRequests: string[] = [];
  await page.route("https://github.com/mobile-profile-fixture.png?size=96", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>',
    }),
  );
  await page.route("**/profile-api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    profileRequests.push(path);
    if (path.endsWith("/sign-in/email")) {
      expect(request.postDataJSON()).toEqual({
        email: "demo@concors.dev",
        password: "profile-fixture-password",
      });
      await route.fulfill({ json: { user: demoMe.user, token: "profile-fixture-token" } });
    } else {
      expect(request.headers()["authorization"]).toBe("Bearer profile-fixture-token");
      await route.fulfill({
        json: path.endsWith("/me")
          ? demoMe
          : path.endsWith("/github/")
            ? {
                configured: true,
                connected: true,
                login: "mobile-profile-fixture",
                updatedAt: null,
                manageUrl: null,
              }
            : { success: true },
      });
    }
  });
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      if (
        event.data?.concorsMobile &&
        /profile-fixture-(token|password)/.test(JSON.stringify(event.data))
      )
        (window as Window & { leakedProfileCredential?: boolean }).leakedProfileCredential = true;
    });
  });
  const workspaceSockets: string[] = [];
  const accountStatuses: string[] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/ws") return;
    workspaceSockets.push(socket.url());
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      const event = JSON.parse(payload);
      if (event.type === "agent.result" && event.outcome?.account)
        accountStatuses.push(event.outcome.account.status);
    });
  });
  const unsubscribe = desktop.subscribeWorkspace(() => undefined);
  const errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && !request.url().includes("/profile-api/"))
      cloudRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const projectId = crypto.randomUUID(),
    tabId = crypto.randomUUID(),
    paneId = crypto.randomUUID();
  const agents = () => desktop.agents.filter((agent) => agent.projectId === projectId);
  const snapshot = () => {
    const current = desktop.workspace;
    if (!current) throw new Error("Desktop control client has no workspace snapshot");
    return current;
  };
  const execute = async (operation: WorkspaceOperation) => {
    const result = await desktop.executeWorkspace({
      type: "workspace.command",
      commandId: crypto.randomUUID(),
      epoch: snapshot().epoch,
      operation,
    });
    expect(result.outcome.status).toBe("accepted");
  };
  try {
    await desktop.connect();
    await expect.poll(() => desktop.workspace?.machineId).toBeTruthy();
    await execute({ kind: "project.add", projectId, name: "Direct acceptance", directory });
    const project = () => {
      const current = snapshot().projects.find((item) => item.id === projectId);
      if (!current) throw new Error("Acceptance project is missing");
      return current;
    };
    await execute({
      kind: "tab.create",
      projectId,
      expectedVersion: project().version,
      tabId,
      paneId,
      name: "Shared chat",
      profile: "chat",
    });
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Live desktop connection/)).toBeVisible();
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    await expect(page.getByText("Before you connect", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Allow AI data sharing" })).toHaveCount(0);
    const ui = page.frameLocator('iframe[title="Concourse workspace"]');
    const input = ui.getByRole("textbox", { name: "Message Codex" });
    await expect(input).toBeEnabled();
    // Main's provider account flow must also cross the mobile relay without a real OAuth login.
    const signIn = ui.getByRole("region", { name: "Codex account connection", exact: true });
    await signIn.getByRole("button", { name: "Sign in with ChatGPT", exact: true }).click();
    // Account flows are socket-scoped: observe the phone's result, not the separate
    // desktop control connection's fixture account. Completed sign-in has no chat badge.
    await expect.poll(() => accountStatuses, { timeout: 10_000 }).toContain("connected");
    await expect(signIn).toHaveCount(0);
    await expect(ui.getByText(/Codex connected|fixture-account@example\.test/)).toHaveCount(0);
    await input.fill("hello over the real daemon transport");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(ui.getByRole("log")).toContainText("Hello from Codex");
    await expect.poll(() => agents().length).toBe(1);
    // The mobile row must retain the provider logo while desktop's working badge animates.
    await input.fill("hold");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    const agentId = agents()[0]?.id;
    if (!agentId) throw new Error("Missing fixture agent");
    const agentRow = ui.locator(`button[data-agent-id="${agentId}"]`);
    await expect(agentRow.locator('[data-provider="codex"] svg')).toBeVisible();
    await expect(agentRow.getByRole("img", { name: "Agent status: Working" })).toBeVisible();
    await expect(agentRow.locator("[data-agent-status-badge] svg .animate-spin")).toBeVisible();
    await agentRow.focus();
    await expect(ui.getByRole("tooltip")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("mobile-agent-status.png") });
    await agentRow.click();
    await ui.getByRole("button", { name: "Interrupt agent", exact: true }).click();
    await expect.poll(() => agents()[0]?.status).not.toBe("working");
    await input.fill("approve command");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(ui.getByRole("region", { name: "Allow command execution?" })).toBeVisible();
    await ui.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect.poll(() => agents()[0]?.status).toBe("done");
    await input.fill("primitive-form");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await ui.getByRole("checkbox", { name: "Unit tests Run the focused suite" }).click();
    await ui.getByRole("checkbox", { name: "Type check Verify types" }).click();
    await ui
      .getByRole("textbox", { name: "Additional notes", exact: true })
      .fill("  Keep indentation.\n");
    await ui.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect.poll(() => agents()[0]?.status).toBe("done");
    await input.fill("primitive-form");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await ui.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect.poll(() => agents()[0]?.status).toBe("done");
    await input.fill("primitive-plan");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      ui.getByRole("heading", { name: "Implementation plan", exact: true }),
    ).toBeVisible();
    await ui.getByRole("button", { name: "Approve plan", exact: true }).click();
    await expect.poll(() => agents()[0]?.status).toBe("done");
    await input.fill("primitive-read");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await ui
      .getByRole("article", { name: "Tool call", exact: true })
      .filter({ hasText: "src/app.ts" })
      .getByRole("button")
      .first()
      .click();
    await expect(ui.getByText("export const previewWorks = true;", { exact: true })).toBeVisible();
    const viewport = await ui
      .locator("body")
      .evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth }));
    expect(viewport.scroll).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: test.info().outputPath("mobile-chat-primitives.png") });
    await ui.getByRole("button", { name: "Browse your messages" }).click();
    const messages = ui.getByRole("dialog", { name: "Your messages", exact: true });
    await expect(
      messages.getByRole("button", { name: /hello over the real daemon transport/ }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("mobile-message-navigation.png") });
    await messages.getByRole("button", { name: /hello over the real daemon transport/ }).click();
    await expect(messages).not.toBeVisible();
    await expect(
      ui.getByRole("log").getByText("hello over the real daemon transport", { exact: true }),
    ).toBeInViewport();

    await execute({
      kind: "tab.rename",
      projectId,
      expectedVersion: project().version,
      tabId,
      name: "Renamed from desktop",
    });
    const picker = ui.getByRole("combobox", { name: "Tabs" });
    await expect(picker).toContainText("Renamed from desktop");
    await picker.click();
    await ui.getByRole("button", { name: "New tab", exact: true }).click();
    await ui
      .getByRole("dialog", { name: "New tab", exact: true })
      .getByRole("button", { name: "Terminal", exact: true })
      .click();
    await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
    await ui.getByLabel("Terminal output", { exact: true }).click();
    await page.keyboard.type("printf 'mobile-%s\\n' direct-terminal");
    await page.keyboard.press("Enter");
    await expect(ui.getByLabel("Terminal output", { exact: true })).toContainText(
      "mobile-direct-terminal",
    );
    await expect.poll(() => project().tabs.length).toBe(2);
    expect(project().tabs.map((tab) => tab.name)).toEqual(["Renamed from desktop", "Tab 2"]);
    await expect.poll(() => desktop.terminals.length).toBe(1);
    const terminalId = desktop.terminals[0]?.id;
    await picker.click();
    await ui.locator(`[data-pane-choice][data-value="${tabId}:${paneId}"]`).click();
    await expect(input).toBeEnabled();
    await input.fill("Unsent draft survives reconnect");
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Account: Your profile", exact: true }).click();
    const account = ui.getByRole("dialog", { name: "Account", exact: true });
    await expect(ui.getByRole("dialog", { name: "Settings", exact: true })).toHaveCount(0);
    await expect(account.getByRole("combobox", { name: "Machine", exact: true })).toContainText(
      "Desktop daemon",
    );
    await expect(account).toContainText("Sign in to your Concourse account");
    expect(profileRequests).toEqual([]);
    const socketsBeforeProfile = workspaceSockets.length;
    await account.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("demo@concors.dev");
    await page.getByLabel("Password", { exact: true }).fill("profile-fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      ui.getByRole("button", { name: "Account: Alex Morgan", exact: true }),
    ).toBeVisible();
    await ui.getByRole("button", { name: "Account: Alex Morgan", exact: true }).click();
    await expect(account.locator("[data-account-avatar] img")).toHaveAttribute(
      "src",
      "https://github.com/mobile-profile-fixture.png?size=96",
    );
    await expect(account).toContainText("demo@concors.dev");
    await expect(account.getByRole("combobox", { name: "Machine", exact: true })).toContainText(
      "Desktop daemon",
    );
    await account.getByRole("button", { name: "Your profile", exact: true }).click();
    await page.getByRole("button", { name: "Sign out of profile", exact: true }).click();
    await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
    expect(workspaceSockets).toHaveLength(socketsBeforeProfile);
    expect(desktop.terminals[0]?.id).toBe(terminalId);
    expect(profileRequests).toEqual([
      "/profile-api/api/auth/sign-in/email",
      "/profile-api/api/v1/me",
      "/profile-api/api/v1/github/",
      "/profile-api/api/auth/sign-out",
    ]);
    expect(
      await page.evaluate(
        () => (window as Window & { leakedProfileCredential?: boolean }).leakedProfileCredential,
      ),
    ).toBeUndefined();
    await ui.getByRole("button", { name: "Account: Your profile", exact: true }).click();
    await account.getByRole("button", { name: "Add machine", exact: true }).click();
    const addMachine = ui.getByRole("dialog", { name: "Add machine", exact: true });
    await expect(addMachine).toContainText("paired with one desktop daemon");
    await addMachine.getByRole("button", { name: "Close", exact: true }).click();
    await ui.getByRole("button", { name: "Account: Your profile", exact: true }).click();
    await account.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
    await expect(settings).toContainText(snapshot().machineId);
    await settings.getByRole("combobox", { name: "Settings section" }).click();
    await ui.getByRole("option", { name: "Providers", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Agent providers" })).toBeVisible();
    await settings.getByRole("textbox", { name: "Search providers" }).fill("Copilot");
    await expect(settings.getByText("GitHub Copilot", { exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "Configure GitHub Copilot" }).click();
    const providerEditor = ui.getByRole("dialog", { name: "Configure GitHub Copilot" });
    await providerEditor.getByLabel("Name", { exact: true }).fill("Mobile Copilot");
    await providerEditor.getByRole("button", { name: "Save provider" }).click();
    await expect(providerEditor).toHaveCount(0);
    const savedProvider = await desktop.requestProvider({ kind: "list" }, crypto.randomUUID());
    expect(savedProvider.outcome.status).toBe("ok");
    if (savedProvider.outcome.status === "ok")
      expect(savedProvider.outcome.providers.find((p) => p.id === "copilot")?.label).toBe(
        "Mobile Copilot",
      );
    expect(await settings.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: "/tmp/concors-mobile-providers.png", fullPage: true });

    await settings.getByRole("combobox", { name: "Settings section" }).click();
    await expect(ui.getByRole("option", { name: "Billing", exact: true })).toHaveCount(0);
    await ui.getByRole("option", { name: "Shortcuts", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Tabs", exact: true })).toBeVisible();
    await expect(settings.getByRole("heading", { name: "Panes", exact: true })).toHaveCount(0);
    await expect(settings).toContainText("With an external keyboard");
    await expect(settings.getByText("New pane beside current", { exact: true })).toHaveCount(0);
    await settings.getByRole("combobox", { name: "Settings section" }).click();
    await ui.getByRole("option", { name: "Appearance", exact: true }).click();
    await settings.getByRole("button", { name: "Reconnect", exact: true }).click();
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue("Unsent draft survives reconnect");
    await expect(ui.getByRole("log")).toContainText("Hello from Codex");
    expect(desktop.terminals[0]?.id).toBe(terminalId);
    // Disconnect closes this viewer, not the remote terminal or cloud account.
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Account: Your profile", exact: true }).click();
    await account.getByRole("button", { name: "Settings", exact: true }).click();
    await settings.getByRole("button", { name: "Disconnect desktop", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Connect to desktop", exact: true }),
    ).toBeVisible();
    expect(desktop.terminals[0]?.status).toBe("running");
    await page.goto(
      `/session?machineId=${snapshot().machineId}&projectId=${projectId}&tabId=${tabId}&paneId=${paneId}`,
    );
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    // Reconnect goes straight to the workspace, without a second onboarding gate.
    await expect(input).toBeEnabled();
    await expect(ui.getByRole("log")).toContainText("Hello from Codex");
    await expect(input).toHaveValue("");
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Account: Your profile", exact: true }).click();
    await account.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings.getByText("AI data sharing", { exact: true })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Review AI data sharing" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Allow AI data sharing" })).toHaveCount(0);
    await settings.getByRole("button", { name: "Disconnect desktop", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Connect to desktop", exact: true }),
    ).toBeVisible();
    await expect(page.locator('iframe[title="Concourse workspace"]')).toHaveCount(0);
    expect(desktop.terminals[0]?.status).toBe("running");
    expect(cloudRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    // The dedicated fixture daemon is stopped by Playwright; only this test's folder is removed.
    desktop.disconnect();
    unsubscribe();
    await rm(directory, { recursive: true, force: true });
  }
});
