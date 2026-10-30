import type { Locator, Page } from "@playwright/test";

/**
 * A tab nobody named shows its main pane's title, which several tabs can share ("Terminal"), so
 * specs find tabs by their place in the bar.
 */
export function tabs(scope: Page | Locator) {
  return scope.getByLabel("Project tabs", { exact: true }).locator("[data-tab-id]");
}

/** The button that selects the tab at `index` (0 is the first tab). */
export function tab(scope: Page | Locator, index: number) {
  return tabs(scope).nth(index).locator("> button").first();
}

/** The ✕ that closes the tab at `index`. */
export function closeTab(scope: Page | Locator, index: number) {
  return tabs(scope)
    .nth(index)
    .getByRole("button", { name: /^Close .* tab$/ });
}
