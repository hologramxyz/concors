import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, signedIn } from "./signed-in.ts";
import { createPersistentGateway } from "../packages/daemon/src/hosting/gateway.ts";
import { ensureSessionHost, stopSessionHost } from "../packages/daemon/src/hosting/session-host.ts";

test("Codex and Claude panes reconnect to the same processes, then recover lost sessions without an interruption screen", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const directory = await mkdtemp(join(tmpdir(), "concors-browser-continuity-"));
  const launch = {
    executable: process.execPath,
    args: [
      fileURLToPath(new URL("../packages/daemon/src/hosting/testing/host.ts", import.meta.url)),
    ],
  };
  const config = { host: "127.0.0.1", port: 0, logLevel: "silent" } as const;
  let gateway = createPersistentGateway(config, directory, launch);
  let live = false;
  const context = await browser.newContext();
  try {
    const url = await gateway.listen();
    live = true;
    const port = Number(new URL(url).port);
    const second = await context.newPage();
    for (const client of [page, second]) {
      await signedIn(client);
      if (new URL(test.info().project.use.baseURL ?? "http://localhost:1420").port !== "1420") {
        // This private host intentionally only trusts the standard UI origin. For
        // an alternate-port local checkout, forward through a native test socket;
        // the real gateway/session host and reconnect assertions remain unchanged.
        await client.routeWebSocket(`ws://127.0.0.1:${port}/ws`, (socket) => {
          const upstream = new WebSocket(`ws://127.0.0.1:${port}/ws`);
          const pending: (string | Buffer)[] = [];
          socket.onMessage((message) => {
            if (upstream.readyState === WebSocket.OPEN) upstream.send(message);
            else pending.push(message);
          });
          upstream.addEventListener("open", () => {
            for (const message of pending) upstream.send(message);
            pending.length = 0;
          });
          upstream.addEventListener("message", (event) => socket.send(String(event.data)));
          upstream.addEventListener("close", () => socket.close());
          upstream.addEventListener("error", () => socket.close());
          socket.onClose(() => upstream.close());
        });
      }
      await client.addInitScript((target) => {
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = class extends NativeWebSocket {
          constructor(address: string | URL, protocols?: string | string[]) {
            super(String(address).includes(":7429/ws") ? target : address, protocols);
          }
        };
      }, `ws://127.0.0.1:${port}/ws`);
    }
    await page.goto("/");
    await seedProject(page, "Persistent agents", directory, `ws://127.0.0.1:${port}/ws`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Pane actions", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Codex", exact: true }).click();
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "SESSION_PID:",
    );
    await page.getByRole("button", { name: "Pane actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Split horizontally", exact: true }).click();
    await page.getByRole("button", { name: "Pane actions", exact: true }).last().click();
    await page.getByRole("menuitemradio", { name: "Claude Code", exact: true }).click();
    const terminals = page.getByLabel("Terminal output").filter({ visible: true });
    await expect(terminals).toHaveCount(2);
    await expect(terminals.last()).toContainText("SESSION_PID:");
    const pids = await terminals.allTextContents();
    const paneIds = await page
      .locator("[data-pane-id]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-pane-id")));
    await second.goto("/");
    await expect(second.getByLabel("Terminal output").filter({ visible: true })).toHaveCount(2);
    await gateway.close();
    live = false;
    await expect(terminals.first()).toContainText("SESSION_PID:");
    await expect(page.getByText("Session interrupted", { exact: true })).toHaveCount(0);
    gateway = createPersistentGateway({ ...config, port }, directory, launch);
    await gateway.listen();
    live = true;
    await expect(page.getByRole("status").filter({ hasText: "Reconnecting" })).toHaveCount(0);
    await page.reload();
    await expect(terminals).toHaveCount(2);
    for (const [index, text] of pids.entries()) {
      const pid = /SESSION_PID:\d+/.exec(text)?.[0];
      if (!pid) throw new Error("Test terminal did not report its process ID");
      await expect(terminals.nth(index)).toContainText(pid);
    }
    expect(
      await page
        .locator("[data-pane-id]")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-pane-id"))),
    ).toEqual(paneIds);
    await expect(page.getByRole("button", { name: "Start new session" })).toHaveCount(0);
    // A host crash is different from a gateway restart. Both devices may recover the same panes.
    const host = await ensureSessionHost(directory, launch);
    process.kill(host.pid, "SIGKILL");
    await expect(terminals.first()).toContainText("RECOVERY_PICKER_READY", { timeout: 20000 });
    await expect(terminals.last()).toContainText("RECOVERY_PICKER_READY", { timeout: 20000 });
    await expect(
      second.getByLabel("Terminal output").filter({ visible: true }).last(),
    ).toContainText("RECOVERY_PICKER_READY");
    await expect(page.getByText("Session interrupted", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start new session" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
    await page.close();
    if (live) await gateway.close();
    await stopSessionHost(directory);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
