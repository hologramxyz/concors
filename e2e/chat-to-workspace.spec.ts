import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { chooseProvider } from "./support/agents.ts";
import { seedProject } from "./support/projects.ts";
import { showClosedChats } from "./support/closed-chats.ts";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";

/** Two workspaces on their own folders, and a chat with a reply in the second one seeded. */
async function setup(page: Page, from: string, to: string) {
  await signedIn(page);
  await page.goto("/");
  await seedProject(page, "Destination", to);
  await seedProject(page, "Origin", from);
  await page.getByRole("button", { name: "New tab options", exact: true }).click();
  await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
  await chooseProvider(page);
  const composer = page.getByRole("textbox", { name: "Message Codex" });
  await expect(composer).toBeEnabled();
  await composer.fill("first message");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log", { name: "Chat timeline" })).toContainText("Hello from");
  return composer;
}
const rows = (page: Page, workspace: string) =>
  page.getByRole("list", { name: `${workspace} tabs`, exact: true });
const chatRow = (page: Page, workspace: string) =>
  rows(page, workspace)
    .locator("li[data-sidebar-row]")
    .filter({
      has: page.locator("[data-agent-id]"),
    });
const workspaceRow = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).locator("xpath=ancestor::li[1]");

test("dragging a chat onto another workspace moves it, and it keeps working in its own folder", async ({
  page,
}) => {
  const from = await mkdtemp(join(tmpdir(), "concors-chat-move-from-"));
  const to = await mkdtemp(join(tmpdir(), "concors-chat-move-to-"));
  // Only the folder the chat began in has this, so opening it proves where the chat still runs.
  await writeFile(join(from, "README.md"), "# Only in the origin folder");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const composer = await setup(page, from, to);
    const row = chatRow(page, "Origin");
    await expect(row).toHaveAttribute("draggable", "true");
    const destination = workspaceRow(page, "Destination");

    // The workspace it would land in says so; its own does not offer itself.
    await row.hover();
    await page.mouse.down();
    const box = await destination.boundingBox();
    if (!box) throw new Error("Workspace row missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    // A drop needs an "over" on where it lands, which a moving pointer alone does not produce.
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await expect(destination).toHaveAttribute("data-drop-target", "true");
    await page.screenshot({ path: test.info().outputPath("chat-over-workspace.png") });
    await page.mouse.up();

    await expect(chatRow(page, "Destination")).toHaveCount(1);
    await expect(chatRow(page, "Origin")).toHaveCount(0);
    await expect(destination).not.toHaveAttribute("data-drop-target");
    // It was the chat in view, so the view went with it, with the conversation intact.
    await expect(page.getByRole("log", { name: "Chat timeline" })).toContainText("first message");

    await composer.fill("file-links");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("link", { name: "the README", exact: true }).click();
    await expect(page.getByText("Only in the origin folder")).toBeVisible();

    // The daemon's doing, not this window's: it is still there after a reload.
    await page.reload();
    await expect(chatRow(page, "Destination")).toHaveCount(1);
    await expect(chatRow(page, "Origin")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});

test("a closed chat moves from its menu, and opens in the workspace it moved to", async ({
  page,
}) => {
  const from = await mkdtemp(join(tmpdir(), "concors-chat-move-closed-from-"));
  const to = await mkdtemp(join(tmpdir(), "concors-chat-move-closed-to-"));
  try {
    await setup(page, from, to);
    const open = chatRow(page, "Origin");
    await open.hover();
    await page
      .getByRole("button", { name: /^Close .* tab$/ })
      .last()
      .click();
    await showClosedChats(page, "Origin");
    const closed = rows(page, "Origin").locator('li[data-sidebar-row^="closed:"]');
    await expect(closed).toHaveCount(1);

    await closed.hover();
    await closed.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Move to workspace" }).click();
    await page.getByRole("menuitem", { name: "Destination", exact: true }).click();
    await showClosedChats(page, "Destination");
    const moved = rows(page, "Destination").locator('li[data-sidebar-row^="closed:"]');
    await expect(moved).toHaveCount(1);
    await expect(closed).toHaveCount(0);

    await moved.locator("button[data-agent-id]").click();
    await expect(page.getByRole("log", { name: "Chat timeline" })).toContainText("first message");
    await expect(chatRow(page, "Destination")).toHaveCount(1);
    await expect(
      rows(page, "Destination")
        .locator('li[data-sidebar-row^="tab:"]')
        .filter({
          has: page.locator("[data-agent-id]"),
        }),
    ).toHaveCount(1);
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});

test("a terminal's row stays put: it has no drag and no move in its menu", async ({ page }) => {
  const from = await mkdtemp(join(tmpdir(), "concors-chat-move-terminal-from-"));
  const to = await mkdtemp(join(tmpdir(), "concors-chat-move-terminal-to-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Destination", to);
    await seedProject(page, "Origin", from);
    const row = rows(page, "Origin").locator('li[data-sidebar-row^="tab:"]').first();
    await expect(row).toHaveAttribute("draggable", "false");
    await row.hover();
    await row.getByRole("button", { name: /^Actions for / }).click();
    await expect(page.getByRole("menuitem", { name: "Rename tab" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Move to workspace" })).toHaveCount(0);
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});

const visiblePanes = (page: Page) => page.locator("[data-pane-id]").filter({ visible: true });
/** Splits the chat in view, so its tab holds it and a second pane. Returns the chat's pane. */
async function splitChat(page: Page) {
  const chat = visiblePanes(page).first();
  const id = await chat.getAttribute("data-pane-id");
  if (!id) throw new Error("Pane ID missing");
  await chat.getByRole("button", { name: "Pane actions" }).click();
  await page.getByRole("menuitem", { name: "Split horizontally" }).click();
  await expect(visiblePanes(page)).toHaveCount(2);
  return page.locator(`[data-pane-id="${id}"]`);
}
/** Holds a pane by its header over `target`, leaving the button down. */
async function holdPaneOver(
  page: Page,
  pane: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>,
) {
  const header = await pane.locator("header").boundingBox();
  const box = await target.boundingBox();
  if (!header || !box) throw new Error("Pane header or target missing");
  await page.mouse.move(header.x + 60, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
}

test("a chat dragged out of a split joins another workspace's tab beside what it holds", async ({
  page,
}) => {
  const from = await mkdtemp(join(tmpdir(), "concors-pane-move-from-"));
  const to = await mkdtemp(join(tmpdir(), "concors-pane-move-to-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await setup(page, from, to);
    const chat = await splitChat(page);
    const chatId = await chat.getAttribute("data-pane-id");
    // Destination's own tab, a terminal: a chat can join it, whatever it holds.
    const target = rows(page, "Destination").locator('li[data-sidebar-row^="tab:"]').first();
    const tabId = await target.getAttribute("data-drop-tab");

    await holdPaneOver(page, chat, target);
    await expect(target).toHaveAttribute("data-drop-target", "");
    await page.screenshot({ path: test.info().outputPath("pane-over-workspace-tab.png") });
    await page.mouse.up();
    await expect(target).not.toHaveAttribute("data-drop-target");

    // The view goes with it: the destination tab now shows its terminal and the chat, intact.
    await expect(visiblePanes(page)).toHaveCount(2);
    await expect(page.locator(`[data-pane-id="${chatId}"]`)).toBeVisible();
    await expect(page.getByRole("log", { name: "Chat timeline" }).first()).toContainText(
      "first message",
    );
    await expect(rows(page, "Destination").locator(`li[data-drop-tab="${tabId}"]`)).toHaveCount(1);
    // The tab it left kept its other pane, and the chat is listed where it went.
    await rows(page, "Origin")
      .locator('li[data-sidebar-row^="tab:"]')
      .last()
      .locator("button")
      .first()
      .click();
    await expect(visiblePanes(page)).toHaveCount(1);
    await expect(page.locator(`[data-pane-id="${chatId}"]`).filter({ visible: true })).toHaveCount(
      0,
    );

    // The daemon's layout: after a reload the chat is still in the destination's tab.
    await page.reload();
    await rows(page, "Destination").locator(`li[data-drop-tab="${tabId}"] button`).first().click();
    await expect(page.locator(`[data-pane-id="${chatId}"]`).filter({ visible: true })).toHaveCount(
      1,
    );
    expect(errors).toEqual([]);
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});

test("dropped on a workspace, or sent from its menu, a chat opens in a tab of its own there", async ({
  page,
}) => {
  const from = await mkdtemp(join(tmpdir(), "concors-pane-new-tab-from-"));
  const to = await mkdtemp(join(tmpdir(), "concors-pane-new-tab-to-"));
  try {
    await setup(page, from, to);
    const chat = await splitChat(page);
    const chatId = await chat.getAttribute("data-pane-id");
    const destinationTabs = rows(page, "Destination").locator('li[data-sidebar-row^="tab:"]');
    const before = await destinationTabs.count();
    const destination = workspaceRow(page, "Destination");
    await holdPaneOver(page, chat, destination);
    await expect(destination).toHaveAttribute("data-drop-target", "");
    await page.mouse.up();
    await expect(destinationTabs).toHaveCount(before + 1);
    await expect(visiblePanes(page)).toHaveCount(1);
    await expect(page.locator(`[data-pane-id="${chatId}"]`)).toBeVisible();

    // And back, from the pane's menu, into Origin's tab it came from, beside the pane it left.
    await chat.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Move to workspace" }).click();
    const originTabs = page
      .getByRole("group", { name: "Origin", exact: true })
      .getByRole("menuitem");
    await expect(originTabs.first()).toHaveText("New tab");
    await originTabs.last().click();
    await expect(destinationTabs).toHaveCount(before);
    await expect(visiblePanes(page)).toHaveCount(2);
    await expect(page.locator(`[data-pane-id="${chatId}"]`)).toBeVisible();
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});

test("a chat's row dropped on another workspace's tab row joins that tab", async ({ page }) => {
  const from = await mkdtemp(join(tmpdir(), "concors-row-join-from-"));
  const to = await mkdtemp(join(tmpdir(), "concors-row-join-to-"));
  try {
    await setup(page, from, to);
    const row = chatRow(page, "Origin");
    const target = rows(page, "Destination").locator('li[data-sidebar-row^="tab:"]').first();
    await row.hover();
    await page.mouse.down();
    const box = await target.boundingBox();
    if (!box) throw new Error("Tab row missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await expect(target).toHaveAttribute("data-drop-target", "");
    await page.mouse.up();
    await expect(chatRow(page, "Origin")).toHaveCount(0);
    await expect(visiblePanes(page)).toHaveCount(2);
    await expect(page.getByRole("log", { name: "Chat timeline" }).first()).toContainText(
      "first message",
    );
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});

test("a chat beside a terminal, or with a schedule, still moves, and its schedule goes with it", async ({
  page,
}) => {
  const from = await mkdtemp(join(tmpdir(), "concors-mixed-move-from-"));
  const to = await mkdtemp(join(tmpdir(), "concors-mixed-move-to-"));
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "mixed move", version: "0.0.0" },
  });
  try {
    control.subscribeWorkspace(() => undefined);
    await control.connect();
    await setup(page, from, to);
    // The chat's tab gets a terminal beside it.
    const chat = await splitChat(page);
    const chatId = await chat.getAttribute("data-pane-id");
    const other = visiblePanes(page).last();
    await other.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitemradio", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".xterm").filter({ visible: true })).toBeVisible();
    // And a schedule, paused, which older daemons would have kept in this workspace.
    const origin = () => control.workspace?.projects.find((p) => p.directory === from);
    const destination = () => control.workspace?.projects.find((p) => p.directory === to);
    await expect.poll(() => origin()?.id).toBeTruthy();
    const originId = origin()?.id;
    const session = control.agents.find((agent) => agent.projectId === originId);
    if (!originId || !session) throw new Error("Chat missing");
    const created = await control.requestSchedule(
      {
        kind: "create",
        schedule: {
          name: "Nightly",
          projectId: originId,
          prompt: "Summarize the day",
          target: { kind: "session", sessionId: session.id },
          cadence: { kind: "interval", minutes: 60 },
          enabled: false,
        },
      },
      crypto.randomUUID(),
    );
    expect(created.outcome.status).toBe("ok");

    const row = chatRow(page, "Origin");
    await row.hover();
    await row.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Move to workspace" }).click();
    await page.getByRole("menuitem", { name: "Destination", exact: true }).click();

    // The chat has a tab of its own there; the terminal stayed, in the tab it was in.
    await expect(chatRow(page, "Destination")).toHaveCount(1);
    await expect(chatRow(page, "Origin")).toHaveCount(0);
    await expect(page.locator(`[data-pane-id="${chatId}"]`).filter({ visible: true })).toHaveCount(
      1,
    );
    await expect(rows(page, "Origin").locator('li[data-sidebar-row^="tab:"]')).toHaveCount(2);
    await expect
      .poll(async () => {
        const list = await control.requestSchedule({ kind: "list" }, crypto.randomUUID());
        return list.outcome.status === "ok" ? list.outcome.schedules?.[0]?.projectId : undefined;
      })
      .toBe(destination()?.id);
  } finally {
    control.disconnect();
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});
