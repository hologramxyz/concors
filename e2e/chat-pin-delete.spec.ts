import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";
import { closeTab, tab, tabs } from "./support/tabs.ts";

test("chats are pinned to the top of their workspace, and deleted after a confirmation", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-pin-delete-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Pinned chats", directory);
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const rows = sidebar.getByRole("list", { name: "Pinned chats tabs" }).locator("> li");

    for (const message of ["hello there", "hello again"]) {
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await chooseProvider(page);
      const composer = page.getByRole("textbox", { name: "Message Codex" });
      await expect(composer).toBeEnabled();
      await composer.fill(message);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByRole("log").filter({ visible: true })).toContainText("Hello from");
    }
    const pane = page.getByRole("region", { name: "Agent pane", exact: true });
    await pane.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Rename pane" }).click();
    await pane.getByRole("textbox", { name: "Pane name", exact: true }).fill("Release notes");
    await page.keyboard.press("Enter");
    await closeTab(page, 2).click();
    const closed = rows.filter({ hasText: "Release notes" });
    await expect(closed.locator("button[data-agent-closed]")).toBeVisible();
    await expect(rows.first()).not.toContainText("Release notes");

    // Pinned, the closed chat leads its workspace with a pin; unpinned, it goes back. Rows keep
    // their places while the pointer is over the list, so it moves away to let them settle.
    const away = () => page.mouse.move(900, 500);
    await closed.hover();
    await closed.getByRole("button", { name: "Actions for Release notes" }).click();
    await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
    await expect(closed.getByRole("img", { name: "Pinned" })).toBeVisible();
    await away();
    await expect(rows.first()).toContainText("Release notes");
    await expect(rows.first().getByRole("img", { name: "Pinned" })).toBeVisible();
    await closed.hover();
    await closed.getByRole("button", { name: "Actions for Release notes" }).click();
    await page.getByRole("menuitem", { name: "Unpin", exact: true }).click();
    await expect(closed.getByRole("img", { name: "Pinned" })).toHaveCount(0);
    await away();
    await expect(rows.first()).not.toContainText("Release notes");

    // Deleting asks first; cancelling keeps the chat.
    await closed.hover();
    await closed.getByRole("button", { name: "Actions for Release notes" }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Delete “Release notes”?" });
    await expect(confirm).toContainText("You’ll have a few seconds to undo.");
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(closed).toHaveCount(1);
    await closed.hover();
    await closed.getByRole("button", { name: "Actions for Release notes" }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(closed).toHaveCount(0);

    // Deleting an open chat closes its tab too.
    await expect(tabs(page)).toHaveCount(2);
    const open = rows.filter({ has: page.locator("button[data-sidebar-tab-id]") }).last();
    await open.hover();
    await open.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await page
      .getByRole("dialog", { name: /^Delete “/ })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(sidebar.locator("button[data-agent-id]")).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const DAEMON = "ws://127.0.0.1:7429/ws";
interface Message {
  type?: string;
  requestId?: string;
  operation?: { kind?: string; sessionId?: string };
}

/** Starts a chat in a new tab for each message and returns the workspace's sidebar rows. */
async function startChats(page: Page, workspace: string, directory: string, messages: string[]) {
  await signedIn(page);
  await page.goto("/");
  await seedProject(page, workspace, directory);
  for (const message of messages) {
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await chooseProvider(page);
    await send(page, message);
  }
  return page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("list", { name: `${workspace} tabs` })
    .locator("> li");
}

async function send(page: Page, message: string) {
  const composer = page.getByRole("textbox", { name: "Message Codex" }).filter({ visible: true });
  const button = page
    .getByRole("button", { name: "Send message", exact: true })
    .filter({ visible: true });
  await expect(composer).toBeEnabled();
  // A chat that has just opened can redraw its composer, dropping what was typed before.
  await expect(async () => {
    await composer.fill(message);
    await expect(button).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await button.click();
  await expect(page.getByRole("log").filter({ visible: true })).toContainText("Hello from");
}

/** Opens the delete dialog from the row's menu and returns it, titled after the row's chat. */
async function askToDelete(page: Page, row: Locator) {
  await row.hover();
  const actions = row.getByRole("button", { name: /^Actions for / });
  const name = (await actions.getAttribute("aria-label"))?.replace(/^Actions for /, "");
  await actions.click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  return page.getByRole("dialog", { name: `Delete “${name}”?` });
}

/** The "Chat deleted" notice. */
const deletedNotice = (page: Page) => page.getByRole("status").filter({ hasText: "Chat deleted" });

/** Ends the undo at once, which sends the delete. */
async function deleteNow(page: Page) {
  await deletedNotice(page).getByRole("button", { name: "Dismiss", exact: true }).click();
}

/** Every error a dialog or notice shows, even one gone again by the time the test looks. */
async function recordErrors(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { errors: string[] }).errors = seen;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll("[role=dialog] [role=alert], [role=status]")) {
        const text = node.textContent ?? "";
        if (/Couldn’t|Could not|in progress/.test(text) && !seen.includes(text)) seen.push(text);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { errors: string[] }).errors);
}

test("a delete whose answer is lost to a disconnect finishes quietly once the machine is back", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-delete-disconnect-"));
  const errors = await recordErrors(page);
  // The daemon deletes the chat, but its answer never arrives: the socket drops first, and the
  // app sends the same request again on the next one.
  let cut = false;
  let deleting: string | null = null;
  let answered = false;
  let connections = 0;
  await page.routeWebSocket(DAEMON, (socket) => {
    connections++;
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as Message;
      if (message.type === "agent.request" && message.operation?.kind === "delete")
        deleting = message.requestId ?? null;
      server.send(raw);
    });
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as Message;
      if (message.type === "agent.result" && message.requestId === deleting) {
        if (cut) {
          cut = false;
          void socket.close();
          return;
        }
        answered = true;
      }
      socket.send(raw);
    });
  });
  try {
    const rows = await startChats(page, "Deleting offline", directory, ["first", "second"]);
    const chats = rows.filter({ has: page.locator("button[data-agent-id]") });
    await expect(chats).toHaveCount(2);
    const kept = await chats.first().getAttribute("data-sidebar-row");
    const dialog = await askToDelete(page, chats.last());
    cut = true;
    const before = connections;
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await deleteNow(page);

    await expect.poll(() => connections).toBeGreaterThan(before);
    await expect.poll(() => answered).toBe(true);
    await expect(chats).toHaveCount(1);
    await expect(chats.first()).toHaveAttribute("data-sidebar-row", kept ?? "");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await errors()).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deleting a chat the machine already deleted finishes quietly", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-delete-gone-"));
  const errors = await recordErrors(page);
  // Another device deletes the chat just before this one's request arrives.
  let race = false;
  let answered = false;
  await page.routeWebSocket(DAEMON, (socket) => {
    const server = socket.connectToServer();
    let deleting: string | undefined;
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as Message;
      if (race && message.type === "agent.request" && message.operation?.kind === "delete") {
        race = false;
        deleting = message.requestId;
        server.send(JSON.stringify({ ...message, requestId: crypto.randomUUID() }));
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      if ((JSON.parse(String(raw)) as Message).requestId === deleting) answered = true;
      socket.send(raw);
    });
  });
  try {
    const rows = await startChats(page, "Deleting twice", directory, ["first", "second"]);
    await closeTab(page, 2).click();
    const closed = rows.filter({ has: page.locator("button[data-agent-closed]") });
    await expect(closed).toHaveCount(1);
    const dialog = await askToDelete(page, closed);
    race = true;
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await deleteNow(page);
    await expect.poll(() => answered).toBe(true);
    await expect(closed).toHaveCount(0);
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await errors()).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a delete that cannot reach the machine says so in one line, and works once it is back", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-delete-unreachable-"));
  await page.clock.install();
  let reachable = true;
  await page.routeWebSocket(DAEMON, (socket) => {
    if (!reachable) {
      void socket.close({ code: 1006 });
      return;
    }
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as Message;
      // The request is lost with the socket, and the machine stays out of reach.
      if (message.type === "agent.request" && message.operation?.kind === "delete" && !reachable) {
        void socket.close({ code: 1006 });
        return;
      }
      server.send(raw);
    });
    server.onMessage((raw) => socket.send(raw));
  });
  try {
    const rows = await startChats(page, "Deleting unreachable", directory, ["first", "second"]);
    await closeTab(page, 2).click();
    const closed = rows.filter({ has: page.locator("button[data-agent-closed]") });
    await expect(closed).toHaveCount(1);
    const dialog = await askToDelete(page, closed);
    reachable = false;
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await deleteNow(page);
    // Past the request's deadline and the wait for the machine to come back.
    await page.clock.fastForward(60_000);
    await page.clock.fastForward(16_000);
    await expect(page.getByRole("status").filter({ hasText: "Couldn’t delete" })).toHaveText(
      /^Couldn’t delete “.+”\. Couldn’t reach this computer\. Try again\.$/,
    );

    reachable = true;
    // Past the reconnect backoff: the chat is listed again and can be deleted.
    await page.clock.fastForward(31_000);
    await expect(closed).toHaveCount(1);
    await (await askToDelete(page, closed)).getByRole("button", { name: "Delete" }).click();
    await deleteNow(page);
    await expect(closed).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a deleted chat can be brought back with its tab until the notice ends", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-delete-undo-"));
  await page.clock.install();
  const deletes: string[] = [];
  await page.routeWebSocket(DAEMON, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as Message;
      if (message.type === "agent.request" && message.operation?.kind === "delete")
        deletes.push(message.operation.sessionId ?? "");
      server.send(raw);
    });
    server.onMessage((raw) => socket.send(raw));
  });
  try {
    const rows = await startChats(page, "Undoing", directory, ["first", "second"]);
    const chats = rows.filter({ has: page.locator("button[data-agent-id]") });
    await expect(tabs(page)).toHaveCount(3);
    // The first chat's tab sits between the terminal's and the second chat's.
    await tab(page, 1).click();
    const shown = (id: string | null) =>
      page.locator(`button[data-agent-id="${id}"][aria-current="true"]`);
    const id = await page
      .locator('nav button[data-agent-id][aria-current="true"]')
      .getAttribute("data-agent-id");
    const row = chats.filter({ has: page.locator(`button[data-agent-id="${id}"]`) });

    // Undo puts the tab back in its place, shown again when it was the one shown.
    for (const selected of [true, false]) {
      await tab(page, selected ? 1 : 2).click();
      await (await askToDelete(page, row)).getByRole("button", { name: "Delete" }).click();

      // Gone from the list and the tab bar at once, with a way back.
      await expect(deletedNotice(page)).toBeVisible();
      await expect(chats).toHaveCount(1);
      await expect(tabs(page)).toHaveCount(2);
      await deletedNotice(page).getByRole("button", { name: "Undo", exact: true }).click();
      await expect(deletedNotice(page)).toHaveCount(0);
      await expect(chats).toHaveCount(2);
      await expect(tabs(page)).toHaveCount(3);
      if (selected) await expect(shown(id)).toBeVisible();
      await expect(async () => {
        await tab(page, 1).click();
        await expect(shown(id)).toBeVisible({ timeout: 1_000 });
      }).toPass();
    }
    expect(deletes).toEqual([]);

    // Left alone, the notice ends and only then is the chat really deleted.
    await (await askToDelete(page, row)).getByRole("button", { name: "Delete" }).click();
    await expect(deletedNotice(page)).toBeVisible();
    await page.clock.fastForward(9_000);
    expect(deletes).toEqual([]);
    await page.clock.fastForward(1_500);
    await expect.poll(() => deletes).toEqual([id]);
    await expect(deletedNotice(page)).toHaveCount(0);
    await expect(chats).toHaveCount(1);
    await expect(tabs(page)).toHaveCount(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only the chat whose dialog was confirmed is deleted, whatever changed meanwhile", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-delete-right-chat-"));
  const deletes: string[] = [];
  let current: { close: () => Promise<void> } | undefined;
  let connections = 0;
  await page.routeWebSocket(DAEMON, (socket) => {
    connections++;
    current = socket;
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as Message;
      if (message.type === "agent.request" && message.operation?.kind === "delete")
        deletes.push(message.operation.sessionId ?? "");
      server.send(raw);
    });
    server.onMessage((raw) => socket.send(raw));
  });
  try {
    const rows = await startChats(page, "Right chat", directory, ["alpha", "beta", "gamma"]);
    // Alpha and beta closed, so they are listed by recency and move when either is used.
    await closeTab(page, 1).click();
    await expect(tabs(page)).toHaveCount(3);
    await closeTab(page, 1).click();
    await expect(tabs(page)).toHaveCount(2);
    const closed = rows.filter({ has: page.locator("button[data-agent-closed]") });
    await expect(closed).toHaveCount(2);
    const ids = await page
      .locator("nav button[data-agent-id]")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-agent-id")));
    expect(new Set(ids).size).toBe(3);

    // Another row's menu opened and closed first.
    const other = closed.first();
    await other.hover();
    await other.getByRole("button", { name: /^Actions for / }).click();
    await page.keyboard.press("Escape");
    const target = closed.last();
    const chosen = await target.locator("button[data-agent-id]").getAttribute("data-agent-id");
    const dialog = await askToDelete(page, target);
    const title = await dialog.getByRole("heading").innerText();

    // Meanwhile, from another window: the other closed chat opens (the selected tab changes, and
    // the sidebar re-sorts) and gets a new message; then this window's connection drops.
    const second = await page.context().newPage();
    await signedIn(second);
    await second.goto("/");
    await second
      .getByRole("navigation", { name: "Primary" })
      .locator(`button[data-agent-id]:not([data-agent-id="${chosen}"])[data-agent-closed]`)
      .click();
    await send(second, "moving");
    const before = connections;
    await current?.close();
    await expect.poll(() => connections).toBeGreaterThan(before);
    await expect(dialog.getByRole("heading")).toHaveText(title);

    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await deleteNow(page);
    await expect.poll(() => deletes).toEqual([chosen]);
    const left = await page
      .locator("nav button[data-agent-id]")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-agent-id")));
    expect(new Set(left)).toEqual(new Set(ids.filter((id) => id !== chosen)));
    await second.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
