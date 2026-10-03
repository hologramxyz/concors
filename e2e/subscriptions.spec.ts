import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { SubscriptionLibrary, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { managedHost } from "./support/managed-host.ts";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";
import type { ProviderConfig, ProviderOperation } from "../packages/protocol/src/index.ts";

/** Provider operations on one of the fixture daemons: 7429 is this computer, 7430 the second machine. */
async function onDaemon<T>(
  port: number,
  use: (provider: (operation: ProviderOperation) => Promise<ProviderList>) => Promise<T>,
): Promise<T> {
  const daemon = new DaemonConnection({
    endpoint: describeDaemonEndpoint(`ws://127.0.0.1:${port}/ws`),
    client: { kind: "test", name: "subscriptions fixture", version: "0.0.0" },
  });
  const unsubscribe = daemon.subscribeWorkspace(() => undefined);
  try {
    await daemon.connect();
    await expect.poll(() => daemon.workspace).not.toBeNull();
    return await use(async (operation) => {
      const result = await daemon.requestProvider(operation, crypto.randomUUID());
      if (result.outcome.status !== "ok") throw new Error(result.outcome.message);
      return result.outcome as ProviderList;
    });
  } finally {
    unsubscribe();
    daemon.disconnect();
  }
}
interface ProviderList {
  revision: number;
  providers: { id: string; subscription?: unknown; active?: boolean }[];
}
const subscriptionConfig = (id: string, engine: "claude" | "codex", nickname: string) =>
  ({
    id,
    label: `${engine === "claude" ? "Claude" : "ChatGPT"} — ${nickname}`,
    engine,
    command: [engine],
    enabled: true,
    subscription: { nickname },
  }) satisfies ProviderConfig;
/** The fixture daemons are shared by the whole run; leave both on their default accounts. */
async function forgetSubscriptions() {
  for (const port of [7429, 7430])
    await onDaemon(port, async (provider) => {
      let list = await provider({ kind: "list" });
      for (const held of list.providers.filter((p) => p.subscription))
        list = await provider({ kind: "remove", id: held.id, expectedRevision: list.revision });
    });
}

test("adds accounts to a library and assigns one per provider to each machine", async ({
  page,
}) => {
  test.setTimeout(75_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-subscriptions-ui-"));
  const library = new SubscriptionLibrary();
  try {
    await forgetSubscriptions();
    await signedIn(page, undefined, library);
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
    // Assignment changes are staged, then saved together after a confirmation.
    const saveAssignments = async () => {
      await section.getByRole("button", { name: "Save changes", exact: true }).click();
      const confirm = page.getByRole("dialog", { name: "Save subscription changes?" });
      await confirm.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(confirm).toHaveCount(0);
      await expect(
        section.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeDisabled();
    };

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
    await saveAssignments();
    // A signed-in assignment needs no status line; only a missing sign-in is called out.
    await expect(local.getByText("Needs sign-in", { exact: true })).toHaveCount(0);
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
    await saveAssignments();
    await expect(second.getByText("Needs sign-in", { exact: true })).toBeVisible();
    await second.getByRole("button", { name: "Connect Claude on Second machine" }).click();
    connectDialog = page.getByRole("dialog", { name: "Claude — Account" });
    await connectDialog.getByRole("button", { name: "Connect account", exact: true }).click();
    await connectDialog.getByLabel("Authorization code").fill("test-second-machine-code");
    await connectDialog.getByRole("button", { name: "Connect", exact: true }).click();
    await connectDialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(second.getByText("Needs sign-in", { exact: true })).toHaveCount(0);
    await expect(
      second.getByRole("button", { name: "Connect Claude on Second machine" }),
    ).toHaveCount(0);

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

    // The library, with each account's email and chosen name, is kept for every computer.
    await expect
      .poll(() =>
        library.active.map(({ engine, accountNickname, accountLabel }) => ({
          engine,
          accountNickname,
          accountLabel,
        })),
      )
      .toEqual([
        { engine: "claude", accountNickname: null, accountLabel: "fixture-account@example.test" },
        {
          engine: "codex",
          accountNickname: "Work ChatGPT",
          accountLabel: "fixture-account@example.test",
        },
      ]);
  } finally {
    await forgetSubscriptions().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("another computer lists the same accounts, and what each machine uses", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-subscriptions-other-computer-"));
  // Added and assigned to the second machine from a first computer, which this one is not.
  const library = new SubscriptionLibrary();
  library.save("claude-work-e2e", {
    engine: "claude",
    nickname: "Work",
    accountLabel: "work@example.test",
  });
  library.save("claude-gone-e2e", { engine: "claude", nickname: "Gone" });
  library.removed.add("claude-gone-e2e");
  try {
    await forgetSubscriptions();
    await onDaemon(7430, async (provider) => {
      const { revision } = await provider({ kind: "list" });
      const saved = await provider({
        kind: "save",
        config: subscriptionConfig("claude-work-e2e", "claude", "Work"),
        expectedRevision: revision,
      });
      await provider({
        kind: "activate",
        engine: "claude",
        id: "claude-work-e2e",
        expectedRevision: saved.revision,
      });
    });
    // This computer still holds an account from before the library was kept online, and one
    // removed from the library on another computer.
    await onDaemon(7429, async (provider) => {
      let list = await provider({ kind: "list" });
      for (const config of [
        subscriptionConfig("codex-old-e2e", "codex", "Old"),
        subscriptionConfig("claude-gone-e2e", "claude", "Gone"),
      ])
        list = await provider({ kind: "save", config, expectedRevision: list.revision });
    });

    await signedIn(page, undefined, library);
    await managedHost(page);
    await page.goto("/");
    await seedProject(page, "Subscriptions elsewhere", directory);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: /^Account:/ })
      .click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Subscriptions", exact: true })
      .click();
    const section = page.getByRole("region", { name: "Subscriptions" });

    const work = section.getByRole("group", { name: "Claude subscription work@example.test" });
    await expect(work).toContainText("Not set up on this computer");
    // Its limits come from the machine using it, since this computer is not signed in to it.
    await expect(work.getByRole("progressbar", { name: "Session" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    await expect(work).toContainText("Usage from Second machine");
    await work.screenshot({ path: test.info().outputPath("remote-usage.png") });
    const second = section.getByRole("group", { name: "Second machine assignments" });
    await expect(second.getByText("Online", { exact: true })).toBeVisible();
    const secondClaude = second.getByRole("button", { name: "Second machine Claude subscription" });
    await expect(secondClaude).toContainText("work@example.test");
    await expect(section.getByText("Unavailable subscription")).toHaveCount(0);

    // What this computer held joins the library; what was removed stays removed.
    await expect(section.getByRole("group", { name: "ChatGPT subscription Old" })).toBeVisible();
    await expect
      .poll(() => library.active.map((row) => row.id))
      .toEqual(["claude-work-e2e", "codex-old-e2e"]);
    await expect(section.getByRole("group", { name: /subscription Gone$/ })).toHaveCount(0);

    // Connecting here sets the account up on this computer, then signs in as usual.
    await work.getByRole("button", { name: "Connect", exact: true }).click();
    const connect = page.getByRole("dialog", { name: "Claude — Work" });
    await expect(connect.getByRole("button", { name: "Connect account" })).toBeVisible();
    await expect
      .poll(() =>
        onDaemon(7429, async (provider) =>
          (await provider({ kind: "list" })).providers.some((p) => p.id === "claude-work-e2e"),
        ),
      )
      .toBe(true);
  } finally {
    await forgetSubscriptions().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
