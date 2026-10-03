import type { Page } from "@playwright/test";

type Scope = Pick<Page, "getByRole">;

/**
 * A new agent pane waits for its provider; tests that do not care about it use Codex. The menu
 * opens in a portal, so a pane-scoped `scope` needs the page or frame it renders into as `root`.
 */
export async function chooseProvider(scope: Scope, provider = "Codex", root: Scope = scope) {
  await scope.getByRole("button", { name: "Providers", exact: true }).click();
  await root.getByRole("option", { name: new RegExp(`^${provider}( |$)`) }).click();
}
