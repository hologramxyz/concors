import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";

test("mobile connects without cloud login and shares real daemon chat, panes and terminal sessions", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-mobile-direct-project-"));
  const desktop = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7440/ws"),
    client: { kind: "desktop", name: "direct-acceptance-desktop", version: "0.1.0" },
  });
  const cloudRequests: string[] = [];
  const workspaceSockets: string[] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/ws") workspaceSockets.push(socket.url());
  });
  const unsubscribe = desktop.subscribeWorkspace(() => undefined);
  const errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) cloudRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const projectId = crypto.randomUUID(),
    tabId = crypto.randomUUID(),
    paneId = crypto.randomUUID();
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
    await expect(page.getByText("Before you connect", { exact: true })).toBeVisible();
    await expect(page.getByText(/Codex uses OpenAI/)).toBeVisible();
    expect(workspaceSockets).toEqual([]);
    await page.getByRole("button", { name: "Not now", exact: true }).click();
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    await page.getByRole("button", { name: "Allow AI data sharing", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    const input = ui.getByRole("textbox", { name: "Message Codex" });
    await expect(input).toBeEnabled();
    await input.fill("hello over the real daemon transport");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(ui.getByRole("log")).toContainText("Hello from Codex");
    await expect.poll(() => desktop.agents.length).toBe(1);
    await input.fill("approve command");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(ui.getByRole("region", { name: "Allow command execution?" })).toBeVisible();
    await ui.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect.poll(() => desktop.agents[0]?.status).toBe("done");
    await input.fill("primitive-form");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await ui.getByRole("checkbox", { name: "Unit tests Run the focused suite" }).click();
    await ui.getByRole("checkbox", { name: "Type check Verify types" }).click();
    await ui
      .getByRole("textbox", { name: "Additional notes", exact: true })
      .fill("  Keep indentation.\n");
    await ui.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect.poll(() => desktop.agents[0]?.status).toBe("done");
    await input.fill("primitive-form");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await ui.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect.poll(() => desktop.agents[0]?.status).toBe("done");
    await input.fill("primitive-plan");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      ui.getByRole("heading", { name: "Implementation plan", exact: true }),
    ).toBeVisible();
    await ui.getByRole("button", { name: "Approve plan", exact: true }).click();
    await expect.poll(() => desktop.agents[0]?.status).toBe("done");
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

    await execute({
      kind: "tab.rename",
      projectId,
      expectedVersion: project().version,
      tabId,
      name: "Renamed from desktop",
    });
    const picker = ui.getByRole("combobox", { name: "Tabs and panes" });
    await expect(picker).toContainText("Renamed from desktop");
    await picker.click();
    await ui
      .getByRole("button", { name: "Actions for tab Renamed from desktop", exact: true })
      .click();
    await ui.getByRole("menuitem", { name: "Add pane to this tab", exact: true }).click();
    await ui
      .getByRole("dialog", { name: "Add pane", exact: true })
      .getByRole("button", { name: "Terminal", exact: true })
      .click();
    await expect(ui.getByLabel("Terminal output", { exact: true })).toBeVisible();
    await ui.getByLabel("Terminal output", { exact: true }).click();
    await page.keyboard.type("printf 'mobile-%s\\n' direct-terminal");
    await page.keyboard.press("Enter");
    await expect(ui.getByLabel("Terminal output", { exact: true })).toContainText(
      "mobile-direct-terminal",
    );
    await expect
      .poll(() => project().tabs[0]?.nodes.filter((node) => node.kind === "pane").length)
      .toBe(2);
    await expect.poll(() => desktop.terminals.length).toBe(1);
    const terminalId = desktop.terminals[0]?.id;
    await picker.click();
    await ui.locator(`[data-pane-choice][data-value="${tabId}:${paneId}"]`).click();
    await expect(input).toBeEnabled();
    await input.fill("Unsent draft survives reconnect");
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Desktop connection settings" }).click();
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
    await expect(settings.getByRole("heading", { name: "Panes", exact: true })).toBeVisible();
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
    await ui.getByRole("button", { name: "Desktop connection settings" }).click();
    await settings.getByRole("button", { name: "Disconnect desktop", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Connect to desktop", exact: true }),
    ).toBeVisible();
    expect(desktop.terminals[0]?.status).toBe("running");
    await page.goto(
      `/session?machineId=${snapshot().machineId}&projectId=${projectId}&tabId=${tabId}&paneId=${paneId}`,
    );
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    // Browser preview storage is memory-only; a full navigation asks again.
    await page.getByRole("button", { name: "Allow AI data sharing", exact: true }).click();
    await expect(input).toBeEnabled();
    await expect(ui.getByRole("log")).toContainText("Hello from Codex");
    await expect(input).toHaveValue("");
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Desktop connection settings" }).click();
    await settings.getByRole("button", { name: "Review AI data sharing", exact: true }).click();
    await settings.getByRole("button", { name: "Withdraw and disconnect", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Allow AI data sharing", exact: true }),
    ).toBeVisible();
    await expect(page.locator('iframe[title="Concors workspace"]')).toHaveCount(0);
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
