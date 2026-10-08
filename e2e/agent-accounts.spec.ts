import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

for (const result of ["connected", "disconnected", "error"] as const) {
  test(`initial account check stays quiet until ${result} response`, async ({ page }) => {
    const directory = await mkdtemp(join(tmpdir(), "concors-account-loading-"));
    let requestId: string | undefined;
    let release: (() => void) | undefined;
    let delivered = false;
    let providerLists = 0;
    await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((raw) => {
        const event = JSON.parse(String(raw));
        if (event.type === "provider.request" && event.operation.kind === "list") providerLists++;
        if (
          !delivered &&
          event.type === "agent.request" &&
          event.operation.kind === "account" &&
          event.operation.action.type === "read"
        )
          requestId = event.requestId;
        server.send(raw);
      });
      server.onMessage((raw) => {
        const event = JSON.parse(String(raw));
        if (requestId && event.requestId === requestId) {
          requestId = undefined;
          release = () => {
            release = undefined;
            delivered = true;
            if (result === "error") {
              event.outcome = { status: "error", message: "Could not check this account." };
            } else {
              event.outcome.account.status = result;
            }
            socket.send(JSON.stringify(event));
          };
        } else socket.send(raw);
      });
    });
    try {
      await signedIn(page);
      await page.goto("/");
      await seedProject(page, "Account loading", directory);
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
      await chooseProvider(page);
      // Choosing the chat's provider lists them once; the account check must not list again.
      providerLists = 0;
      const prompt = page.getByRole("region", { name: "Codex account connection", exact: true });
      await expect.poll(() => !!release).toBe(true);
      await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
      await expect(prompt).toHaveCount(0);
      release?.();
      if (result === "connected") {
        // Synchronize with rendering after delivery, rather than checking before React updates.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await expect(prompt).toHaveCount(0);
      } else if (result === "disconnected") {
        await expect(prompt.getByRole("button", { name: "Sign in with ChatGPT" })).toBeEnabled();
      } else {
        // Only a failed check asks whether the CLI is installed; listing holds up the daemon.
        await expect.poll(() => providerLists).toBe(1);
        await expect(prompt.getByRole("alert")).toContainText("Could not check this account.");
        await prompt.getByRole("button", { name: "Check account", exact: true }).click();
        await expect(prompt.getByRole("button", { name: "Sign in with ChatGPT" })).toBeEnabled();
      }
      if (result !== "error") expect(providerLists).toBe(0);
    } finally {
      release?.();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("the first sign-in click survives a background focus refresh", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-account-focus-"));
  let holdNextRead = false;
  let heldRequest: string | undefined;
  let release: (() => void) | undefined;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (
        holdNextRead &&
        event.type === "agent.request" &&
        event.operation.kind === "account" &&
        event.operation.action.type === "read"
      ) {
        holdNextRead = false;
        heldRequest = event.requestId;
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (heldRequest && event.requestId === heldRequest) {
        heldRequest = undefined;
        release = () => {
          release = undefined;
          socket.send(raw);
        };
      } else socket.send(raw);
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "First-click sign-in", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const prompt = page.getByRole("region", { name: "Codex account connection", exact: true });
    const signIn = prompt.getByRole("button", { name: "Sign in with ChatGPT", exact: true });
    await expect(signIn).toBeEnabled();
    holdNextRead = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => !!release).toBe(true);
    await expect(signIn).toBeEnabled();
    await signIn.click();
    release?.();
    await expect(prompt).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect(page.getByText(/Codex connected|fixture-account@example\.test/)).toHaveCount(0);
  } finally {
    release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [provider, label] of [
  ["codex", "Codex"],
  ["claude", "Claude Code"],
  ["opencode", "OpenCode"],
] as const) {
  test(`${label}: dismiss sign-in, connect and keep account identity out of chat`, async ({
    page,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "concors-account-ui-"));
    try {
      await signedIn(page);
      await page.goto("/");
      await seedProject(page, "Agent accounts", directory);
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
      await chooseProvider(page);
      await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
      if (provider !== "codex") {
        await page.getByRole("button", { name: "Agent and model", exact: true }).click();
        await page.getByRole("button", { name: "Back to providers", exact: true }).click();
        await page.getByRole("option", { name: `${label} Use in this pane`, exact: true }).click();
        await page.getByRole("option", { name: `Fixture ${provider} model`, exact: true }).click();
      }
      const prompt = page.getByRole("region", { name: `${label} account connection` });
      const composer = page.getByRole("textbox", { name: `Message ${label}` });
      await expect(prompt).toBeVisible();
      await expect(composer).toBeEnabled();
      const promptBox = await prompt.boundingBox();
      const inputBox = await composer.boundingBox();
      if (!promptBox || !inputBox) throw new Error("Missing account prompt or composer");
      expect(promptBox.y).toBeLessThan(inputBox.y);
      await prompt.getByRole("button", { name: "Dismiss account connection" }).click();
      await expect(prompt).toHaveCount(0);
      await composer.fill("Continue without connecting an account");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByRole("log")).toContainText("Hello from");
      await page.reload();
      await expect(composer).toBeEnabled();
      await expect(prompt).toHaveCount(0);
      await page.getByRole("button", { name: "Connect account", exact: true }).click();
      await prompt
        .getByRole("button", {
          name:
            provider === "codex"
              ? "Sign in with ChatGPT"
              : provider === "opencode"
                ? "Add API key"
                : "Connect account",
          exact: true,
        })
        .click();
      await expect(prompt.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      await prompt.screenshot({ path: test.info().outputPath("account-prompt.png") });
      if (provider === "codex") {
        await expect(prompt).toContainText("TEST-CODE");
        await expect(prompt.getByRole("button", { name: "Open sign-in page" })).toBeVisible();
      } else {
        // Password inputs have no implicit textbox role.
        await prompt
          .getByLabel(provider === "claude" ? "Authorization code" : "Provider API key", {
            exact: true,
          })
          .fill("test-private-credential");
        await prompt.getByRole("button", { name: "Connect", exact: true }).click();
      }
      await expect(prompt).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: `${label} connected` })).toHaveCount(
        0,
      );
      await expect(page.getByText("fixture-account@example.test", { exact: false })).toHaveCount(0);
      await expect(page.getByRole("log")).not.toContainText("test-private-credential");
      await expect(page.getByRole("log")).not.toContainText("TEST-CODE");
      await expect(composer).toBeEnabled();
      await composer.fill("Continue after connecting an account");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByRole("log")).toContainText("Continue after connecting an account");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("a missing CLI is offered as a one-click install instead of an account check", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-account-install-"));
  // The test daemon's CLIs are fixtures, so a missing Codex and its install are played here.
  let cli: "missing" | "installing" | "installed" = "missing";
  let installs = 0;
  const accountReads = new Set<string>();
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (event.type === "agent.request" && event.operation.kind === "account")
        accountReads.add(event.requestId);
      if (event.type === "provider.request" && event.operation.kind === "install") {
        installs++;
        cli = "installing";
        event.operation = { kind: "list" };
        server.send(JSON.stringify(event));
        return;
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (event.type === "provider.result" && event.outcome.status === "ok") {
        const state = cli;
        // The first check after starting reports the install as still running.
        if (cli === "installing") cli = "installed";
        event.outcome.providers = event.outcome.providers.map((p: { id: string }) =>
          p.id === "codex"
            ? {
                ...p,
                installed: state === "installed",
                installStatus: state === "missing" ? "idle" : state,
              }
            : p,
        );
        socket.send(JSON.stringify(event));
        return;
      }
      if (accountReads.delete(event.requestId) && cli !== "installed") {
        event.outcome = { status: "error", message: "Codex is not installed on this machine." };
        socket.send(JSON.stringify(event));
        return;
      }
      socket.send(raw);
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Missing CLI", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const install = page.getByRole("region", { name: "Codex installation", exact: true });
    const account = page.getByRole("region", { name: "Codex account connection", exact: true });
    await expect(install).toBeVisible();
    await expect(account).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check account" })).toHaveCount(0);
    await expect(page.getByText("Codex is not installed on this machine.")).toHaveCount(0);
    await expect(install.getByRole("button", { name: "Installation guide" })).toBeVisible();
    await install.screenshot({ path: test.info().outputPath("install-prompt.png") });
    await install.getByRole("button", { name: "Install Codex", exact: true }).click();
    await expect.poll(() => installs).toBe(1);
    // Once installed, the usual sign-in takes its place.
    await expect(install).toHaveCount(0, { timeout: 10_000 });
    await expect(account.getByRole("button", { name: "Sign in with ChatGPT" })).toBeEnabled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Codex sign-in keeps its code across a tab switch and copies it for the sign-in page", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-account-code-"));
  let cancels = 0;
  let connected = false;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (
        event.type === "agent.request" &&
        event.operation.kind === "account" &&
        event.operation.action.type === "cancel"
      )
        cancels++;
      server.send(raw);
    });
    server.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (event.type === "agent.result" && event.outcome?.account?.status === "connected")
        connected = true;
      socket.send(raw);
    });
  });
  try {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await signedIn(page);
    await page.goto("/");
    // The sign-in page itself is out of scope; only the code handed to it matters here.
    await page.evaluate(() => {
      window.open = () => null;
    });
    await seedProject(page, "Sign-in code", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const prompt = page.getByRole("region", { name: "Codex account connection", exact: true });
    await prompt.getByRole("button", { name: "Sign in with ChatGPT", exact: true }).click();
    await expect(prompt).toContainText("TEST-CODE");
    await prompt.getByRole("button", { name: "Open sign-in page", exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("TEST-CODE");
    // Leaving the tab while entering the code in the browser must not cancel the sign-in: the
    // fixture approves it a moment later, and the chat comes back connected.
    await page.getByRole("button", { name: "Tab 1", exact: true }).click();
    await expect(prompt).toHaveCount(0);
    await page.getByRole("button", { name: "Tab 2", exact: true }).click();
    await expect.poll(() => connected, { timeout: 10_000 }).toBe(true);
    await expect(prompt).toHaveCount(0);
    expect(cancels).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
