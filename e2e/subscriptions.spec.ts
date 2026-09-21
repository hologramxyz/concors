import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("add a Claude subscription in settings, sign it in, use it in a chat, and remove it", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-subscriptions-ui-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Subscriptions", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();

    const primaryNavigation = page.getByRole("navigation", { name: "Primary" });
    await primaryNavigation.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const settingsNavigation = page.getByRole("navigation", { name: "Settings" });
    await settingsNavigation.getByRole("button", { name: "Subscriptions", exact: true }).click();
    const section = page.getByRole("region", { name: "Subscriptions" });
    await expect(section).toBeVisible();
    // The built-in sign-ins are listed per engine before any extra subscription exists.
    await expect(section.getByText("Default account")).toHaveCount(2);

    await section.getByRole("button", { name: "Add subscription", exact: true }).click();
    const addDialog = page.getByRole("dialog", { name: "Add a subscription" });
    await addDialog.getByLabel("Name").fill("Work");
    await addDialog.getByRole("button", { name: "Add subscription", exact: true }).click();

    // Saving immediately opens the sign-in for the new subscription.
    const connectDialog = page.getByRole("dialog", { name: "Claude — Work" });
    await expect(connectDialog).toBeVisible();
    await connectDialog.getByRole("button", { name: "Connect account", exact: true }).click();
    await connectDialog.getByLabel("Provider API key").fill("test-fixture-key");
    await connectDialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(connectDialog).toContainText("Connected as fixture-account@example.test");
    await connectDialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(section.getByText("Connected · fixture-account@example.test")).toBeVisible();

    // The signed-in subscription is selectable for the existing chat pane.
    await settingsNavigation.getByRole("button", { name: "Back to app", exact: true }).click();
    await page.getByLabel("Agent and model", { exact: true }).click();
    await page.getByRole("button", { name: "Back to providers" }).click();
    await expect(
      page.getByRole("option", { name: /^Claude — Work Use in this pane$/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Removing the subscription signs it out on the machine and drops it from the list.
    await primaryNavigation.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await settingsNavigation.getByRole("button", { name: "Subscriptions", exact: true }).click();
    await section.getByRole("button", { name: "Remove Work", exact: true }).click();
    await section.getByRole("button", { name: "Sign out and remove", exact: true }).click();
    await expect(section.getByText("Work", { exact: true })).toHaveCount(0);
    await expect(section.getByText("Default account")).toHaveCount(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
