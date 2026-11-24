import { expect, type Page } from "@playwright/test";

/**
 * Opens a workspace's "Closed" group in the sidebar, folded by default: its closed chats, and the
 * coding agent CLIs still running with their panes closed. Those that need attention or are at
 * work are listed among the open rows instead, so when there is no group, or it is already open,
 * there is nothing to do. It stays open on reload in the same browser.
 */
export async function showClosedChats(page: Page, workspace: string) {
  const list = page.getByRole("list", { name: `${workspace} tabs`, exact: true });
  const toggle = list.getByRole("button", { name: /^Closed$/ });
  await expect(
    toggle.or(list.locator("button[data-agent-closed], button[data-background-terminal]")).first(),
  ).toBeVisible();
  if ((await toggle.count()) && (await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
}
