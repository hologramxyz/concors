import { expect, type Page } from "@playwright/test";

type Scope = Pick<Page, "getByRole">;

/**
 * A new agent pane waits for its provider; tests that do not care about it use Codex. The menu
 * opens in a portal, so a pane-scoped `scope` needs the page or frame it renders into as `root`.
 */
export async function chooseProvider(scope: Scope, provider = "Codex", root: Scope = scope) {
  // A closing menu (New tab, Pane actions) hands focus back to its button when its exit
  // animation ends, which would close a provider menu opened in the meantime.
  await expect(root.getByRole("menu")).toHaveCount(0);
  await scope.getByRole("button", { name: "Providers", exact: true }).click();
  await root.getByRole("option", { name: new RegExp(`^${provider}( |$)`) }).click();
}
