import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedProject } from "./support/projects.ts";
import { closeTab, tabs } from "./support/tabs.ts";
import { showClosedChats } from "./support/closed-chats.ts";
import { test, expect, signedIn } from "./signed-in.ts";

test("a closed terminal running a command stays in the sidebar, reopens with its screen and stops", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-background-terminals-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Background", directory);
    const sidebar = page.getByRole("list", { name: "Background tabs", exact: true });
    const openTerminal = async () => {
      await page.getByRole("button", { name: "New tab options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
    };

    // A shell waiting at its prompt just closes, and stops.
    await openTerminal();
    await expect(tabs(page)).toHaveCount(2);
    await closeTab(page, 1).click();
    await expect(tabs(page)).toHaveCount(1);
    await page.waitForTimeout(1500);
    await expect(page.getByText(/is still running/)).toHaveCount(0);
    await expect(sidebar.locator("[data-background-terminal]")).toHaveCount(0);

    // A running command keeps going, and the close says so.
    await openTerminal();
    await page.keyboard.type("echo BEFORE_CLOSE; sleep 600");
    await page.keyboard.press("Enter");
    const tabRow = sidebar.locator("li", { has: page.locator("[data-sidebar-tab-id]") }).last();
    await expect(tabRow.locator('[data-row-state="running"]')).toBeVisible({ timeout: 10_000 });
    // Open or closed, it goes by the command it runs.
    await expect(tabs(page).nth(1)).toHaveText("sleep 600");
    await expect(tabRow).toContainText("sleep 600");
    await closeTab(page, 1).click();
    const notice = page.getByRole("status").filter({ hasText: "is still running" });
    await expect(notice).toHaveText(/^sleep 600 is still running/);
    const row = sidebar.locator("[data-background-terminal]");
    await expect(row).toHaveText(/sleep 600/);
    await expect(row.locator(".truncate")).toHaveText("sleep 600");
    await expect(row.locator(".truncate")).toHaveClass(/text-muted-foreground/);
    // Still running with its tab closed: a grey dot, never a spinner.
    await expect(
      row.locator('[data-row-state="running"] > span.bg-muted-foreground'),
    ).toBeVisible();

    // Clicking the row brings it back into a new tab, screen and all, without an empty tab first.
    await page.evaluate(() => {
      const target = window as unknown as { sawNewChat: boolean };
      target.sawNewChat = false;
      new MutationObserver(() => {
        if (
          document.querySelector('[aria-label="Project tabs"]')?.textContent?.includes("New chat")
        )
          target.sawNewChat = true;
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await row.click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(notice).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "BEFORE_CLOSE",
    );
    await expect(tabs(page).nth(1)).toHaveText("sleep 600");
    expect(
      await page.evaluate(() => (window as unknown as { sawNewChat: boolean }).sawNewChat),
    ).toBe(false);

    // Closed again, Stop from the notice ends it, and its row goes.
    await closeTab(page, 1).click();
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect(row).toHaveCount(0);

    // The row's menu reopens and stops too.
    await openTerminal();
    await page.keyboard.type("sleep 600");
    await page.keyboard.press("Enter");
    await expect(tabRow.locator('[data-row-state="running"]')).toBeVisible({ timeout: 10_000 });
    await closeTab(page, 1).click();
    await expect(row).toBeVisible();
    await row.hover();
    await sidebar.getByRole("button", { name: "Actions for sleep 600" }).click();
    await page.getByRole("menuitem", { name: "Stop", exact: true }).click();
    await expect(row).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a closed coding agent tab keeps running under its name and comes back where it was", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-background-agent-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Agent background", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "CODEX_TERMINAL_READY",
    );
    await closeTab(page, 1).click();
    const notice = page.getByRole("status").filter({ hasText: "is still running" });
    // Named, never by the command line it was started with.
    await expect(notice).toHaveText(/^Codex is still running/);
    // Idle, it waits in the workspace's folded "Closed" group.
    await showClosedChats(page, "Agent background");
    const row = page
      .getByRole("list", { name: "Agent background tabs", exact: true })
      .locator("[data-background-terminal]");
    await expect(row.locator(".truncate")).toHaveText("Codex");
    // Dismissing the notice leaves the agent running, still in the sidebar.
    await notice.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(notice).toHaveCount(0);
    await row.click();
    await expect(row).toHaveCount(0);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "CODEX_TERMINAL_READY",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a closed Claude Code CLI waits in the folded Closed group while idle, stays listed while it asks, and reopens from the group", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-closed-cli-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Closed CLIs", directory);
    const list = page.getByRole("list", { name: "Closed CLIs tabs", exact: true });
    const group = list.getByRole("button", { name: /^Closed$/ });
    const groupList = list.getByRole("list", { name: "Closed CLIs closed", exact: true });
    const openClaude = async (count: number) => {
      await page.getByRole("button", { name: "New tab options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Claude Code", exact: true }).click();
      await expect(tabs(page)).toHaveCount(count);
      await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
        "auto mode on",
      );
    };
    await openClaude(2);
    await openClaude(3);
    // The tab on screen is the second one; only its pane is exposed, so this is its terminal.
    await page
      .getByRole("region", { name: "Claude Code pane", exact: true })
      .locator(".xterm-helper-textarea")
      .focus();
    await page.keyboard.type("test-approval");
    await page.keyboard.press("Enter");
    await expect(list.locator('[data-row-state="attention"]')).toHaveCount(1);

    // Idle, the closed CLI goes into the folded group, which has no dot to carry for it.
    await closeTab(page, 1).click();
    await expect(tabs(page)).toHaveCount(2);
    await page.mouse.move(700, 400);
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await expect(group.locator("[data-show-more-dot] span")).toHaveCount(0);
    await expect(list.locator("[data-background-terminal]")).toHaveCount(0);
    await group.click();
    const idle = groupList.locator("[data-background-terminal]");
    await expect(idle).toHaveCount(1);
    await expect(idle.locator(".truncate")).toHaveText("Claude Code");
    // Still running with its pane closed: the grey dot, and a tooltip that says so.
    await expect(
      idle.locator('[data-row-state="running"] > span.bg-muted-foreground'),
    ).toBeVisible();
    await idle.locator(".truncate span").first().hover();
    await expect(page.getByRole("tooltip")).toContainText("Closed and still running");
    await group.click();
    await expect(idle).toHaveCount(0);

    // Waiting for an answer, it stays among the open rows with its red dot.
    await closeTab(page, 1).click();
    await expect(tabs(page)).toHaveCount(1);
    await page.mouse.move(700, 400);
    const waiting = list.locator("[data-background-terminal]");
    await expect(waiting).toHaveCount(1);
    await expect(waiting.locator('[data-row-state="attention"]')).toBeVisible();
    await expect(group).toHaveAttribute("aria-expanded", "false");

    // Reopen from the group's row menu brings it back into a tab.
    await group.click();
    const row = groupList.locator("li[data-sidebar-row]", {
      has: page.locator("[data-background-terminal]"),
    });
    await row.hover();
    await row.getByRole("button", { name: "Actions for Claude Code" }).click();
    await page.getByRole("menuitem", { name: "Reopen", exact: true }).click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(groupList.locator("[data-background-terminal]")).toHaveCount(0);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "auto mode on",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
