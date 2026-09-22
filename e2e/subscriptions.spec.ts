import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { managedHost } from "./support/managed-host.ts";

test("adds accounts to a library and assigns one per provider to each machine", async ({
  page,
}) => {
  test.setTimeout(75_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-subscriptions-ui-"));
  try {
    await signedIn(page);
    // The daemon handshake becomes ready before its workspace snapshot. Keep that real ordering
    // visible long enough to catch provider requests that accidentally run in the gap.
    await managedHost(page, true, 250);
    await page.goto("/");
    await seedProject(page, "Subscriptions", directory);

    const primaryNavigation = page.getByRole("navigation", { name: "Primary" });
    await primaryNavigation.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const settingsNavigation = page.getByRole("navigation", { name: "Settings" });
    await settingsNavigation.getByRole("button", { name: "Subscriptions", exact: true }).click();
    const section = page.getByRole("region", { name: "Subscriptions" });

    const local = section.getByRole("group", { name: "This computer assignments" });
    const second = section.getByRole("group", { name: "Second machine assignments" });
    const staleHeartbeat = section.getByRole("group", { name: "Offline machine assignments" });
    await expect(local.getByText("Online", { exact: true })).toBeVisible();
    await expect(second.getByText("Online", { exact: true })).toBeVisible();
    // Presence comes from the live daemon connection, not a stale control-plane heartbeat.
    await expect(staleHeartbeat.getByText("Online", { exact: true })).toBeVisible();
    await expect(section.getByText("No subscriptions added yet.")).toBeVisible();
    await expect(section.getByText("Claude Code", { exact: true })).toHaveCount(0);

    await section.getByRole("button", { name: "Add subscription", exact: true }).click();
    let addDialog = page.getByRole("dialog", { name: "Add a subscription" });
    await addDialog.getByRole("button", { name: "Add subscription", exact: true }).click();

    let connectDialog = page.getByRole("dialog", { name: "Claude — Account" });
    await connectDialog.getByRole("button", { name: "Connect account", exact: true }).click();
    await connectDialog.getByLabel("Authorization code").fill("test-fixture-code");
    await connectDialog.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(connectDialog).toContainText("Connected");
    await connectDialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      section.getByRole("button", { name: "Rename fixture-account@example.test" }),
    ).toBeVisible();
    const claudeAccount = section.getByRole("group", {
      name: "Claude subscription fixture-account@example.test",
    });
    await expect(claudeAccount.getByRole("progressbar", { name: "Session" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    await expect(claudeAccount).toContainText("42%");
    await expect(claudeAccount).toContainText(/resets in/);
    await expect(
      claudeAccount
        .getByRole("progressbar", { name: "Weekly · Fable" })
        .locator('[data-usage-tone="danger"]'),
    ).toBeVisible();

    const localClaude = local.getByRole("button", {
      name: "This computer Claude subscription",
    });
    await localClaude.click();
    const localClaudeOption = page.getByRole("menuitemradio", {
      name: "Use fixture-account@example.test",
    });
    await expect(localClaudeOption).toContainText("Weekly · Fable");
    await expect(localClaudeOption).toContainText("91%");
    await localClaudeOption.click();
    await expect(local.getByText("Signed in", { exact: true })).toBeVisible();
    await expect(localClaude).toContainText("Weekly · Fable");
    await expect(localClaude).toContainText("91%");

    const assignmentSummary = claudeAccount.getByRole("button", {
      name: "Used on 1 machine: This computer",
    });
    await assignmentSummary.hover();
    await expect(page.getByText("Assigned machines", { exact: true })).toBeVisible();
    await expect(page.getByText("This computer", { exact: true }).last()).toBeVisible();

    const secondClaude = second.getByRole("button", {
      name: "Second machine Claude subscription",
    });
    await secondClaude.click();
    await page.getByRole("menuitemradio", { name: "Use fixture-account@example.test" }).click();
    await expect(second.getByText("Needs sign-in", { exact: true })).toBeVisible();
    await second.getByRole("button", { name: "Connect Claude on Second machine" }).click();
    connectDialog = page.getByRole("dialog", { name: "Claude — Account" });
    await connectDialog.getByRole("button", { name: "Connect account", exact: true }).click();
    await connectDialog.getByLabel("Authorization code").fill("test-second-machine-code");
    await connectDialog.getByRole("button", { name: "Connect", exact: true }).click();
    await connectDialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(second.getByText("Signed in", { exact: true })).toBeVisible();

    // Codex device-code sign-in must survive the page's background provider refresh.
    await section.getByRole("button", { name: "Add subscription", exact: true }).click();
    addDialog = page.getByRole("dialog", { name: "Add a subscription" });
    await addDialog.getByRole("radio", { name: /ChatGPT/ }).check();
    await addDialog.getByRole("button", { name: "Add subscription", exact: true }).click();
    connectDialog = page.getByRole("dialog", { name: "ChatGPT — Account" });
    await connectDialog.getByRole("button", { name: "Sign in with ChatGPT", exact: true }).click();
    await expect(connectDialog).toContainText("TEST-CODE");
    await expect(connectDialog).toContainText("Connected", {
      timeout: 10_000,
    });
    await connectDialog.getByRole("button", { name: "Done", exact: true }).click();

    const subscriptionRows = section.getByRole("group", { name: /subscription / });
    await expect(subscriptionRows.nth(0)).toHaveAccessibleName(
      "Claude subscription fixture-account@example.test",
    );
    await expect(subscriptionRows.nth(1)).toHaveAccessibleName(
      "ChatGPT subscription fixture-account@example.test",
    );

    const chatGptAccount = section.getByRole("group", {
      name: "ChatGPT subscription fixture-account@example.test",
    });
    await chatGptAccount
      .getByRole("button", { name: "Rename fixture-account@example.test" })
      .click();
    const renameDialog = page.getByRole("dialog", { name: "Rename account" });
    await renameDialog.getByLabel("Account name").fill("Work ChatGPT");
    await renameDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(subscriptionRows.nth(0)).toHaveAccessibleName(
      "Claude subscription fixture-account@example.test",
    );
    await expect(subscriptionRows.nth(1)).toHaveAccessibleName("ChatGPT subscription Work ChatGPT");
    await local.getByLabel("This computer ChatGPT subscription").click();
    await expect(page.getByRole("menuitemradio", { name: "Use Work ChatGPT" })).toBeVisible();
    await page.keyboard.press("Escape");

    await settingsNavigation.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
    await settingsNavigation.getByRole("button", { name: "Subscriptions", exact: true }).click();

    const restored = page.getByRole("region", { name: "Subscriptions" });
    const restoredSecond = restored.getByRole("group", { name: "Second machine assignments" });
    await expect(restoredSecond.getByText("Online", { exact: true })).toBeVisible();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(restored.getByText("Workspace is disconnected", { exact: true })).toHaveCount(0);
    // Cached limits render with the page; reconnecting only refreshes them in the background.
    expect(await restored.getByRole("progressbar").count()).toBeGreaterThanOrEqual(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
