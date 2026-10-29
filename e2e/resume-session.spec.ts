import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { tab, closeTab } from "./support/tabs.ts";

/** Opens "Resume a chat…" from the new-tab menu. */
async function openResume(page: Page) {
  await page.getByRole("button", { name: "New tab options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Resume a chat…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Resume a chat", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A row of one agent: every test provider lists the same saved sessions. */
const row = (dialog: Locator, provider: string, name?: string | RegExp) =>
  dialog.locator(`[data-resume-row][data-provider="${provider}"]`, name ? { hasText: name } : {});

test("one list holds closed chats and older CLI sessions, and takes one over in a new tab", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-resume-ui-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Resume workspace", directory);
    const dialog = await openResume(page);
    const search = dialog.getByRole("combobox", { name: "Search chats" });
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(dialog.getByRole("heading")).toHaveCSS("font-size", "16px");
    // One list: no filters, sections or source labels.
    await expect(dialog.getByRole("group")).toHaveCount(0);
    await expect(dialog.getByRole("heading")).toHaveCount(1);
    for (const provider of ["codex", "claude", "opencode", "pi"])
      await expect(row(dialog, provider).first()).toBeVisible();
    // Rows never show folder paths.
    await expect(row(dialog, "codex", /^CLI session/)).not.toContainText(directory);
    // This workspace and every agent to start with; the agent filter narrows the list.
    const workspaceFilter = dialog.getByRole("button", { name: "Workspace", exact: true });
    const agentFilter = dialog.getByRole("button", { name: "Agent", exact: true });
    await expect(workspaceFilter).toHaveText("This workspace");
    await expect(agentFilter).toHaveText("All agents");
    await agentFilter.click();
    await expect(page.getByRole("menuitemradio")).toHaveText([
      "All agents",
      "Claude Code",
      "Codex",
      "OpenCode",
    ]);
    await page.getByRole("menuitemradio", { name: "Claude Code", exact: true }).click();
    await expect(row(dialog, "codex")).toHaveCount(0);
    await expect(row(dialog, "claude").first()).toBeVisible();
    await agentFilter.click();
    await page.getByRole("menuitemradio", { name: "All agents", exact: true }).click();
    await expect(row(dialog, "codex").first()).toBeVisible();
    // Nothing here offers every workspace, where each row names its workspace.
    await search.fill("no such chat");
    await expect(dialog.getByRole("option")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Show all workspaces", exact: true }).click();
    await expect(workspaceFilter).toHaveText("All workspaces");
    await search.fill("");
    await expect(row(dialog, "codex").first()).toContainText("Resume workspace");
    await workspaceFilter.click();
    await page.getByRole("menuitemradio", { name: "This workspace", exact: true }).click();
    await expect(row(dialog, "codex").first()).not.toContainText("Resume workspace");
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath("resume-all-desktop.png") });
    // Older sessions are appended as the list is scrolled.
    await expect
      .poll(async () => {
        await dialog.getByRole("listbox", { name: "Chats" }).evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        return row(dialog, "codex", "Older CLI session 125").count();
      })
      .toBe(1);
    await search.fill("session 125");
    await expect(row(dialog, "codex")).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath("resume-picker-desktop.png") });
    await row(dialog, "codex", "Older CLI session 125").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("log")).toContainText("Saved CLI prompt");
    await expect(page.getByRole("log")).toContainText("Saved CLI response");
    await expect(page.getByRole("button", { name: /^Close .* tab$/ })).toHaveCount(2);
    await expect(tab(page, 1)).toHaveAttribute("aria-pressed", "true");
    const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
    await composer.fill("Continue this saved session");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from");
    await page.screenshot({ path: test.info().outputPath("resumed-desktop.png") });
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume focuses an already open session instead of making a duplicate", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-resume-open-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Existing resume", directory);
    const pick = async () => {
      const dialog = await openResume(page);
      await row(dialog, "codex", /^CLI session/).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("log")).toContainText("Saved CLI response");
    };
    await pick();
    await expect(page.getByRole("button", { name: /^Close .* tab$/ })).toHaveCount(2);
    await tab(page, 0).click();
    await pick();
    await expect(page.getByRole("button", { name: /^Close .* tab$/ })).toHaveCount(2);
    await expect(tab(page, 1)).toHaveAttribute("aria-pressed", "true");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a renamed session is listed once and resumed under its pane name", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-resume-named-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Named resume", directory);
    const pane = page.getByRole("region", { name: "Agent pane", exact: true });
    // Session 42 is used by no other test; the daemon is shared and a session has one workspace.
    const pick = async (search: string, name: string | RegExp) => {
      const dialog = await openResume(page);
      await dialog.getByRole("combobox", { name: "Search chats" }).fill(search);
      // The chat and the CLI session it took over are one row.
      await expect(row(dialog, "codex")).toHaveCount(1);
      await row(dialog, "codex", name).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("log")).toContainText("Saved CLI response");
    };
    await pick("session 42", "Older CLI session 42");
    await pane.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Rename pane" }).click();
    await pane.getByRole("textbox", { name: "Pane name", exact: true }).fill("Hello world");
    await page.keyboard.press("Enter");
    await expect(pane.locator("header").getByText("Hello world", { exact: true })).toBeVisible();
    await closeTab(page, 1).click();
    await expect(pane).toHaveCount(0);

    // Found by the name given to it, not only by the CLI's title.
    await pick("hello", "Hello world");
    await expect(pane.locator("header").getByText("Hello world", { exact: true })).toBeVisible();
    await expect(page.getByText("Loading conversation…")).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** Records every painted frame of the chat timeline, to catch history drawn from the top. */
async function recordFrames(page: Page) {
  await page.evaluate(() => {
    const frames: { items: number; fromBottom: number; first: string | null }[] = [];
    (window as unknown as { chatFrames: typeof frames }).chatFrames = frames;
    // Measure each frame just before it is painted: from a resize observer created during that
    // frame, which is notified after the chat's own observer has pinned the timeline. A timer
    // would also catch layout that a task between frames (a message arriving) changed and the
    // chat corrects before painting, which nobody sees.
    const measure = () => {
      const log = document.querySelector<HTMLElement>('[role="log"]');
      if (log)
        frames.push({
          items: log.querySelectorAll("[data-message-id]").length,
          fromBottom: log.scrollHeight - log.scrollTop - log.clientHeight,
          first: log.querySelector<HTMLElement>("[data-message-id]")?.dataset.messageId ?? null,
        });
    };
    const sample = () => {
      const observer = new ResizeObserver(() => {
        observer.disconnect();
        measure();
      });
      observer.observe(document.documentElement);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return async () => {
    // Let any late items and layout settle before reading what was painted.
    await page.waitForTimeout(1000);
    const frames = await page.evaluate(
      () =>
        (
          window as unknown as {
            chatFrames: { items: number; fromBottom: number; first: string | null }[];
          }
        ).chatFrames,
    );
    const shown = frames.filter((frame) => frame.items);
    expect(shown.length).toBeGreaterThan(0);
    // Never painted the start of the history, and always painted at the bottom.
    expect(shown.filter((frame) => frame.first === "long-user-1")).toEqual([]);
    expect(shown.filter((frame) => frame.fromBottom > 2)).toEqual([]);
  };
}

test("a long session opens at its latest messages when resumed and when reopened", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-resume-long-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Long resume", directory);
    let painted = await recordFrames(page);
    let dialog = await openResume(page);
    await dialog.getByRole("combobox", { name: "Search chats" }).fill("session 77");
    await expect(row(dialog, "codex")).toHaveCount(1);
    await row(dialog, "codex", "Older CLI session 77").click();
    await expect(page.getByRole("log")).toContainText("Long session response 80");
    await painted();

    // Closing the chat stops its CLI; reopening it replays the saved history once more.
    const pane = page.getByRole("region", { name: "Agent pane", exact: true });
    await closeTab(page, 1).click();
    await expect(pane).toHaveCount(0);
    painted = await recordFrames(page);
    dialog = await openResume(page);
    await dialog.getByRole("combobox", { name: "Search chats" }).fill("session 77");
    // Listed once, as the closed chat, which is newer than any CLI session and so comes first.
    await expect(row(dialog, "codex")).toHaveCount(1);
    await expect(dialog.getByRole("option").first()).toHaveAttribute("data-provider", "codex");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("log")).toContainText("Long session response 80");
    await painted();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
