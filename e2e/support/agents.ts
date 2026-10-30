import { expect, type Page } from "@playwright/test";

type Scope = Pick<Page, "getByRole" | "locator">;

/**
 * A new chat starts with the provider used last, then the first installed one. Tests share their
 * machine, so this switches through the model chip when an earlier test left another provider
 * last. A pane-scoped `scope` keeps several chats apart; the chip's menu renders into `root`.
 */
export async function chooseProvider(scope: Scope, provider = "Codex", root: Scope = scope) {
  await expect(root.getByRole("menu")).toHaveCount(0);
  await expect(scope.getByRole("textbox", { name: "Preparing agent", exact: true })).toHaveCount(0);
  const composer = scope.getByRole("textbox", { name: /^Message / }).first();
  // On the mobile native bridge the phone draws the composer, and its provider comes through
  // the bridge, so there is no chip here to switch with.
  const native = scope.locator("[data-native-composer]").first();
  await expect(composer.or(native)).toBeAttached();
  if (await native.count()) return;
  await expect(composer).toBeVisible();
  if ((await composer.getAttribute("aria-label")) === `Message ${provider}`) return;
  // A phone's compact composer shows its controls only once it has focus.
  await composer.click();
  await scope.getByRole("button", { name: "Agent and model", exact: true }).first().click();
  await root.getByRole("button", { name: "Back to providers", exact: true }).click();
  await root.getByRole("option", { name: new RegExp(`^${provider} `) }).click();
  await root.getByRole("option").first().click();
  await expect(
    scope.getByRole("textbox", { name: `Message ${provider}`, exact: true }).first(),
  ).toBeVisible();
}
