import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("a Codex terminal on a machine without Codex offers to install it, then starts", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-terminal-install-"));
  // The test daemon's CLIs are fixtures, so a missing Codex and its install are played here.
  let cli: "missing" | "installing" | "installed" = "missing";
  let armed = false;
  let installs = 0;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (
        armed &&
        cli !== "installed" &&
        event.type === "terminal.request" &&
        event.operation.kind === "start"
      ) {
        socket.send(
          JSON.stringify({
            type: "terminal.result",
            requestId: event.requestId,
            outcome: {
              status: "error",
              message: "codex is not installed on this machine or is missing from PATH",
            },
          }),
        );
        return;
      }
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
      socket.send(raw);
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Missing terminal CLI", directory);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toBeVisible();
    armed = true;
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("codex is not installed");
    const install = page.getByRole("region", { name: "Codex installation", exact: true });
    await expect(install.getByRole("button", { name: "Installation guide" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry terminal" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("terminal-install-prompt.png") });
    await install.getByRole("button", { name: "Install Codex", exact: true }).click();
    await expect.poll(() => installs).toBe(1);
    // Once Codex is in, the terminal starts without another click.
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "CODEX_TERMINAL_READY",
      { timeout: 15_000 },
    );
    await expect(install).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a plain terminal that cannot start offers no install", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-terminal-no-install-"));
  let armed = false;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (armed && event.type === "terminal.request" && event.operation.kind === "start") {
        socket.send(
          JSON.stringify({
            type: "terminal.result",
            requestId: event.requestId,
            outcome: { status: "error", message: "Could not start the shell" },
          }),
        );
        return;
      }
      server.send(raw);
    });
    server.onMessage((raw) => socket.send(raw));
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Shell fails", directory);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toBeVisible();
    armed = true;
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not start the shell");
    await expect(page.getByRole("button", { name: "Retry terminal" })).toBeVisible();
    await expect(page.getByRole("region", { name: /installation$/ })).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
