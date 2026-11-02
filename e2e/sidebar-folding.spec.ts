import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";
import { test, expect, signedIn } from "./signed-in.ts";
import { chooseProvider } from "./support/agents.ts";
import { seedProject } from "./support/projects.ts";
import { closeTab, tab, tabs } from "./support/tabs.ts";

async function connect(name: string) {
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name, version: "0.0.0" },
  });
  control.subscribeWorkspace(() => undefined);
  await control.connect();
  return control;
}

/** Opens `count` chats, each in its own tab after the workspace's first, and returns their IDs. */
async function openChats(page: Page, control: DaemonConnection, directory: string, count: number) {
  const project = () => control.workspace?.projects.find((p) => p.directory === directory);
  await expect.poll(() => project()?.id).toBeTruthy();
  const known = new Set<string>();
  for (let n = 0; n < count; n += 1) {
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await chooseProvider(page);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect
      .poll(
        () =>
          control.agents.filter((a) => a.projectId === project()?.id && !known.has(a.id)).length,
      )
      .toBe(1);
    const agent = control.agents.find((a) => a.projectId === project()?.id && !known.has(a.id));
    assert(agent);
    known.add(agent.id);
  }
  return [...known];
}

const send = (control: DaemonConnection, sessionId: string, text: string) =>
  control.requestAgent({ kind: "send", sessionId, text }, randomUUID());

async function answer(control: DaemonConnection, sessionId: string) {
  const pending = control.agents.find((a) => a.id === sessionId)?.pending[0];
  assert(pending);
  await control.requestAgent(
    { kind: "respond", sessionId, pendingId: pending.id, answers: { color: ["Blue"] } },
    randomUUID(),
  );
}

test("seven open tabs never fold, and the seventh's dot moves from folder to row and clears on open", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const first = await mkdtemp(join(tmpdir(), "concors-fold-a-"));
  const second = await mkdtemp(join(tmpdir(), "concors-fold-b-"));
  const control = await connect("sidebar folding");
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Seven tabs", first);
    const nav = page.getByRole("navigation", { name: "Primary" });
    const list = nav.getByRole("list", { name: "Seven tabs tabs" });
    const opened = await openChats(page, control, first, 6);
    await expect(tabs(page)).toHaveCount(7);
    await expect(list.locator("> li[data-sidebar-row]")).toHaveCount(7);
    await expect(list.getByRole("button", { name: "Show more" })).toHaveCount(0);
    // Tab order, not activity order.
    const barIds = await tabs(page).evaluateAll((all) =>
      all.map((item) => item.getAttribute("data-tab-id")),
    );
    const rowIds = await list
      .locator("button[data-sidebar-tab-id]")
      .evaluateAll((all) => all.map((item) => item.getAttribute("data-sidebar-tab-id")));
    expect(rowIds).toEqual(barIds);

    const seventh = opened.at(-1);
    assert(seventh);
    const project = control.workspace?.projects.find((p) => p.directory === first);
    assert(project);
    await tab(page, 0).click();

    // The seventh finishes while another tab is in front.
    await send(control, seventh, "hello");
    const folderDot = page.locator(
      `[data-workspace-id="${project.id}"] [data-workspace-attention]`,
    );
    const rowState = list.locator(`button[data-agent-id="${seventh}"] [data-row-state]`);
    const tabBadge = tab(page, 6).locator("[data-agent-status-badge]");
    await expect(rowState).toHaveAttribute("data-row-state", "done");
    await expect(rowState.locator("span.bg-primary")).toBeVisible();
    await expect(tabBadge.locator("span.bg-primary")).toBeVisible();
    await expect(tab(page, 6).locator("span.rounded-full")).toHaveCount(2);
    await page.mouse.move(700, 400);

    // Expanded: the row has the dot and the folder does not.
    await expect(folderDot).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("seven-tabs-expanded.png") });
    await page
      .getByLabel("Project tabs", { exact: true })
      .screenshot({ path: test.info().outputPath("seven-tabs-tab-bar.png") });

    // Collapsed: the folder has it. Toggling the folder clears nothing.
    const folder = page.locator(`[data-workspace-id="${project.id}"]`);
    await folder.click();
    await expect(list.locator("xpath=ancestor::li[1]")).toHaveAttribute("data-collapsed", "true");
    await expect(folderDot).toHaveAttribute("data-workspace-attention", "done");
    await page.mouse.move(700, 400);
    // Hidden once its collapse has finished, so the shot shows it shut.
    await expect(list).toBeHidden();
    await page.screenshot({ path: test.info().outputPath("seven-tabs-collapsed.png") });
    expect(control.agents.find((a) => a.id === seventh)?.attention?.seen).toBe(false);
    await folder.click();
    await expect(folderDot).toHaveCount(0);
    await expect(rowState).toHaveAttribute("data-row-state", "done");

    // Leaving and coming back through the folder shows another tab, so it clears nothing either.
    await seedProject(page, "Elsewhere", second);
    await page.getByRole("button", { name: "Elsewhere", exact: true }).click();
    await expect(rowState).toHaveAttribute("data-row-state", "done");
    await folder.click();
    await expect(page.getByRole("heading", { name: "Elsewhere", exact: true })).toHaveCount(0);
    await expect(rowState).toHaveAttribute("data-row-state", "done");
    expect(control.agents.find((a) => a.id === seventh)?.attention?.seen).toBe(false);

    // Opening the chat clears the row and the tab together.
    await list.locator(`button[data-agent-id="${seventh}"]`).click();
    await expect(page.getByRole("log")).toContainText("Hello from Codex");
    await expect(rowState).toHaveCount(0);
    await expect(tabBadge).toHaveCount(0);
    await expect
      .poll(() => control.agents.find((a) => a.id === seventh)?.attention?.seen)
      .toBe(true);
  } finally {
    control.disconnect();
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test("closed tabs fold after three, surface with a dot, and Show more carries one while held", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-fold-closed-"));
  const control = await connect("sidebar closed folding");
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Closed tabs", directory);
    const list = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("list", { name: "Closed tabs tabs" });
    const opened = await openChats(page, control, directory, 6);
    // Each gets a turn, in order, so the closed list has a known order and can be closed. They are
    // in front when they finish, so they close with nothing unread.
    for (const [index, id] of opened.entries()) {
      await tab(page, index + 1).click();
      await send(control, id, "hello");
      await expect.poll(() => control.agents.find((a) => a.id === id)?.attention?.seen).toBe(true);
    }
    await tab(page, 0).click();
    for (let n = 0; n < 5; n += 1) await closeTab(page, 1).click();
    await expect(tabs(page)).toHaveCount(2);
    await page.mouse.move(700, 400);

    const closed = list.locator("button[data-agent-closed]");
    const more = list.getByRole("button", { name: "Show more" });
    await expect(closed).toHaveCount(3);
    await expect(more).toBeVisible();
    // Open rows come first.
    await expect(list.locator("> li").first().locator("button[data-sidebar-tab-id]")).toHaveCount(
      1,
    );
    await expect(more.locator("[data-show-more-dot] span")).toHaveCount(0);

    // Oldest of the closed, so it is folded. Hovering holds the list still: the row stays folded
    // and Show more speaks for it, then it surfaces when the pointer leaves.
    const oldest = opened[0];
    assert(oldest);
    await more.hover();
    await send(control, oldest, "question");
    await expect(
      more.locator('[data-show-more-dot="attention"] span.bg-destructive'),
    ).toBeVisible();
    await expect(closed).toHaveCount(3);
    await page.mouse.move(700, 400);
    const surfaced = list.locator(`button[data-agent-id="${oldest}"]`);
    await expect(surfaced.locator('[data-row-state="attention"]')).toBeVisible();
    // Its new question also made it the newest, so it now leads the three that are listed.
    await expect(closed).toHaveCount(3);
    await expect(closed.first()).toHaveAttribute("data-agent-id", oldest);
    await expect(more.locator("[data-show-more-dot] span")).toHaveCount(0);

    // Show more reveals the rest and clears nothing.
    await more.click();
    await expect(closed).toHaveCount(5);
    await expect(surfaced.locator('[data-row-state="attention"]')).toBeVisible();

    // Opening it and closing it again leaves the question unanswered, so the dot stays.
    await surfaced.click();
    await expect
      .poll(() => control.agents.find((a) => a.id === oldest)?.attention?.seen)
      .toBe(true);
    await closeTab(page, 1).click();
    await expect(surfaced.locator('[data-row-state="attention"]')).toBeVisible();
    await answer(control, oldest);
    await expect(list.locator('[data-row-state="attention"]')).toHaveCount(0);
  } finally {
    control.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a question keeps its red dot after its chat is opened, until it is answered", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-question-"));
  const control = await connect("question dot");
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Question", directory);
    const list = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("list", { name: "Question tabs" });
    const [id] = await openChats(page, control, directory, 1);
    assert(id);
    const project = control.workspace?.projects.find((p) => p.directory === directory);
    assert(project);
    await tab(page, 0).click();
    await send(control, id, "question");

    const row = list.locator(`button[data-agent-id="${id}"]`);
    const rowDot = row.locator('[data-row-state="attention"] span.bg-destructive');
    const tabDot = tab(page, 1).locator("[data-agent-status-badge] span.bg-destructive");
    const folder = page.locator(`[data-workspace-id="${project.id}"]`);
    const folderDot = folder.locator('[data-workspace-attention="needs_input"]');
    await expect(rowDot).toBeVisible();
    await expect(tabDot).toBeVisible();

    // Opened, it has been seen, and is still unanswered.
    await row.click();
    await expect.poll(() => control.agents.find((a) => a.id === id)?.attention?.seen).toBe(true);
    await expect(rowDot).toBeVisible();
    await expect(tabDot).toBeVisible();
    await folder.click();
    await expect(folderDot).toBeVisible();
    await folder.click();
    await expect(folderDot).toHaveCount(0);

    await answer(control, id);
    await expect(row.locator('[data-row-state="attention"]')).toHaveCount(0);
    await expect(tab(page, 1).locator("[data-agent-status-badge] span.bg-destructive")).toHaveCount(
      0,
    );
  } finally {
    control.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a terminal agent's finished turn is marked until viewed, and its question until answered", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-cli-dot-"));
  const control = await connect("terminal dot");
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "CLI dot", directory);
    const shell = page.getByRole("region", { name: "Terminal pane", exact: true });
    const output = shell.getByLabel("Terminal output").filter({ visible: true });
    await expect(output).toContainText("$");
    await shell.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("codex");
    await page.keyboard.press("Enter");
    await expect(output).toContainText("CODEX_TERMINAL_READY");
    const project = control.workspace?.projects.find((p) => p.directory === directory);
    assert(project);
    const list = await control.requestTerminal({ kind: "list" }, randomUUID());
    assert(list.outcome.status === "ok" && "sessions" in list.outcome);
    const id = list.outcome.sessions.find((t) => t.projectId === project.id)?.id;
    assert(id);
    // Attached, this client can take control to type while the tab is behind another.
    await control.requestTerminal({ kind: "attach", sessionId: id }, randomUUID());
    const session = () => control.terminals.find((t) => t.id === id);
    await expect.poll(() => session()?.detectedAgent).toBe("codex");
    const tabId = await tabs(page).first().getAttribute("data-tab-id");
    const row = page.locator(`button[data-sidebar-tab-id="${tabId}"]`);
    const rowDot = (state: string, color: string) =>
      row.locator(`[data-row-state="${state}"] span.${color}`);
    const tabDot = (color: string) =>
      tab(page, 0).locator(`[data-agent-status-badge] span.${color}`);
    // Viewing the tab hands control back to the page, so each command claims it first.
    const type = async (command: string) => {
      await control.requestTerminal(
        { kind: "claim", sessionId: id, cols: 80, rows: 24 },
        randomUUID(),
      );
      control.sendTerminalInput(id, `${command}\r`);
    };
    await type("test-working");
    await expect.poll(() => session()?.agentActivity).toBe("working");

    // It finishes behind another tab: both places say so until the tab is viewed.
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await chooseProvider(page);
    await expect(shell).toBeHidden();
    await type("test-idle");
    await expect(rowDot("done", "bg-primary")).toBeVisible();
    await expect(tabDot("bg-primary")).toBeVisible();
    await tab(page, 0).click();
    await expect(row.locator("[data-row-state]")).toHaveCount(0);
    await expect(tab(page, 0).locator("[data-agent-status-badge]")).toHaveCount(0);

    // Its next turn is news again.
    await type("test-working");
    await expect.poll(() => session()?.agentActivity).toBe("working");
    await tab(page, 1).click();
    await expect(shell).toBeHidden();
    await type("test-idle");
    await expect(rowDot("done", "bg-primary")).toBeVisible();

    // A question stays red while it is viewed.
    await type("test-approval");
    await expect(rowDot("attention", "bg-destructive")).toBeVisible();
    await tab(page, 0).click();
    await expect(shell).toBeVisible();
    await expect(rowDot("attention", "bg-destructive")).toBeVisible();
    await expect(tabDot("bg-destructive")).toBeVisible();
    await type("test-working");
    await expect(row.locator('[data-row-state="attention"]')).toHaveCount(0);
  } finally {
    control.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
