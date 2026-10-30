import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";
import { tab } from "./support/tabs.ts";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";

test("an unanswered notice card goes away by itself, but not while the pointer is on it", async ({
  page,
  context,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-notice-expiry-"));
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "notice expiry", version: "0.0.0" },
  });
  await context.addInitScript(() => {
    class TestNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      onclick: (() => void) | null = null;
      closed = false;
      close() {
        this.closed = true;
      }
    }
    Object.defineProperty(window, "Notification", { value: TestNotification });
  });
  try {
    control.subscribeWorkspace(() => undefined);
    await control.connect();
    await signedIn(page);
    await page.goto("/");
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("navigation", { name: "Settings" });
    await settings.getByRole("button", { name: "Notifications", exact: true }).click();
    await page.getByLabel("Desktop notifications", { exact: true }).check();
    await settings.getByRole("button", { name: "Back to app", exact: true }).click();

    await seedProject(page, "Expiry", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect
      .poll(() => control.workspace?.projects.find((p) => p.directory === directory)?.id)
      .toBeTruthy();
    const project = control.workspace?.projects.find((p) => p.directory === directory);
    assert(project);
    await expect.poll(() => control.agents.some((a) => a.projectId === project.id)).toBe(true);
    const agent = control.agents.find((a) => a.projectId === project.id);
    assert(agent);
    // Hide the agent's chat so its completion becomes a card.
    await tab(page, 0).click();
    await control.requestAgent({ kind: "send", sessionId: agent.id, text: "hello" }, randomUUID());

    const card = page
      .getByRole("complementary", { name: "Agent notifications" })
      .locator(":scope > div")
      .filter({ hasText: "Agent finished" });
    await expect(card).toBeVisible();
    // Longer than the card's five seconds: the pointer on it holds it.
    await card.hover();
    await page.waitForTimeout(6_000);
    await expect(card).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(card).toHaveCount(0, { timeout: 8_000 });
    // Expiry only hides the card; the conversation is still unread.
    expect(control.agents.find((a) => a.id === agent.id)?.attention?.seen).toBe(false);
  } finally {
    control.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
