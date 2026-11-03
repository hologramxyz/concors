import { chooseProvider } from "./support/agents.ts";
import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

test("closing a workspace stops its terminals and keeps it for the + menu to reopen", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-close-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Closing project", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toBeVisible();
    await page.getByRole("button", { name: "Actions for Closing project" }).click();
    const item = page.getByRole("menuitem", { name: "Close workspace…" });
    await expect(item).not.toHaveAttribute("data-variant", "destructive");
    await item.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toHaveText("Close “Closing project”?");
    await expect(dialog).toContainText("Its chats are kept. Reopen it from the + menu.");
    await expect(dialog).toContainText(/\d running terminals? will be stopped\./);
    await dialog.getByRole("button", { name: "Close workspace", exact: true }).click();
    await expect(page.getByRole("button", { name: "Closing project", exact: true })).toHaveCount(0);
    await expect(page.getByText("Unavailable workspace")).toHaveCount(0);
    await page.getByRole("button", { name: "Open workspace menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Closing project" })).toBeVisible();
    // Its folder shows on hover, in the same plain box as the sidebar's tooltips.
    await page.getByRole("menuitem", { name: "Closing project" }).hover();
    await expect(page.getByRole("tooltip")).toHaveText(directory);
    await expect(page.getByRole("tooltip").locator("svg")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("tooltip-recent-workspace.png") });
    await page.getByRole("menuitem", { name: "Closing project" }).click();
    await expect(page.getByRole("button", { name: "Closing project", exact: true })).toBeVisible();
    // Its tabs come back with it.
    await expect(page.getByLabel("Project tabs").locator("[data-tab-id]")).toHaveCount(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("chats of a closed workspace are unavailable only on a daemon that removes workspaces", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-close-away-"));
  const other = await mkdtemp(join(tmpdir(), "concors-still-open-"));
  let reachable = true;
  let older = false;
  const sockets = new Set<{ close: (options?: { code?: number }) => Promise<void> }>();
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    if (!reachable) {
      void socket.close({ code: 1006 });
      return;
    }
    sockets.add(socket);
    const server = socket.connectToServer();
    socket.onMessage((raw) => server.send(raw));
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type?: string; capabilities?: string[] };
      if (older && message.type === "daemon.ready") {
        message.capabilities = message.capabilities?.filter((item) => item !== "project-close");
        socket.send(JSON.stringify(message));
      } else socket.send(raw);
    });
  });
  const cut = () => Promise.all([...sockets].map((socket) => socket.close({ code: 1006 })));
  const unavailable = page.getByText("Unavailable workspace");
  const dot = page.locator("[data-connection]");
  try {
    await signedIn(page);
    await page.goto("/");
    // The sidebar lists these chats below its workspaces, so one has to stay open.
    await seedProject(page, "Still open", other);
    await seedProject(page, "Closed while away", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await chooseProvider(page);
    await page.getByRole("textbox", { name: "Message Codex" }).filter({ visible: true }).fill("hi");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByRole("log").filter({ visible: true })).toContainText("Hello from");
    await page.getByRole("button", { name: "Actions for Closed while away" }).click();
    await page.getByRole("menuitem", { name: "Close workspace…" }).click();
    await page.getByRole("button", { name: "Close workspace", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Closed while away", exact: true })).toHaveCount(
      0,
    );
    await expect(unavailable).toHaveCount(0);

    // The machine drops out: the sidebar keeps its list, and the closed workspace is still closed.
    reachable = false;
    await cut();
    await expect(dot).toHaveAttribute("data-connection", "reconnecting", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Still open", exact: true })).toBeVisible();
    await expect(unavailable).toHaveCount(0);

    // A daemon that does remove workspaces has only this list to show their chats in.
    older = true;
    reachable = true;
    await expect(dot).toHaveAttribute("data-connection", "online", { timeout: 30_000 });
    await expect(unavailable).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});
