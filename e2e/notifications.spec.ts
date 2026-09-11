import { seedProject } from "./support/projects.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test, expect, signedIn } from "./signed-in.ts";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";

test("notifications deduplicate across windows, open chat, and sync unread without replay", async ({
  page,
  context,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-notifications-"));
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "notifications", version: "0.0.0" },
  });
  const errors: string[] = [];
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addInitScript(() => {
    class TestNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      static records: TestNotification[] = [];
      onclick: (() => void) | null = null;
      closed = false;
      constructor(public title: string) {
        TestNotification.records.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    Object.defineProperty(window, "Notification", { value: TestNotification });
  });
  const count = async () => {
    let total = 0;
    for (const p of context.pages())
      total += await p.evaluate(
        () => (Notification as unknown as { records: unknown[] }).records.length,
      );
    return total;
  };
  try {
    control.subscribeWorkspace(() => undefined);
    await control.connect();
    await expect.poll(() => control.workspace).not.toBeNull();
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Notifications acceptance", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await expect(page.getByLabel("Agent status: Ready").first()).toBeVisible();
    // A ready label can belong to an older project, and this separate socket may
    // receive the new workspace/session after the browser. Await this test's agent.
    await expect
      .poll(() => control.workspace?.projects.some((p) => p.directory === directory))
      .toBe(true);
    const project = control.workspace?.projects.find((p) => p.directory === directory);
    assert(project);
    await expect.poll(() => control.agents.some((a) => a.projectId === project.id)).toBe(true);
    const agent = control.agents.find((a) => a.projectId === project.id);
    assert(agent);
    const id = agent.id;
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await page.getByLabel("Desktop notifications", { exact: true }).check();
    const second = await context.newPage();
    await signedIn(second);
    await second.goto("/");
    await second.getByRole("button", { name: /^Account:/ }).click();
    await second.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await second
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await expect(second.getByLabel("Desktop notifications", { exact: true })).toBeChecked();
    await control.requestAgent({ kind: "send", sessionId: id, text: "hello" }, randomUUID());
    await expect.poll(count).toBe(1);
    // Settings deliberately replaces the app sidebar, so verify the shared unread state directly.
    await expect
      .poll(() => control.agents.find((agent) => agent.id === id)?.attention?.seen)
      .toBe(false);
    // Notification clicks navigate asynchronously; use the window that owns the notification.
    let opened = page;
    for (const p of context.pages()) {
      const clicked = await p.evaluate(() => {
        const records = (Notification as unknown as { records: { onclick: (() => void) | null }[] })
          .records;
        if (!records[0]?.onclick) return false;
        records[0].onclick();
        return true;
      });
      if (clicked) opened = p;
    }
    await opened.bringToFront();
    await expect(opened.getByRole("log")).toContainText("Hello from Codex");
    await expect.poll(() => control.agents.find((a) => a.id === id)?.attention?.seen).toBe(true);
    await expect(page.getByLabel("Unread agent update")).toHaveCount(0);
    await expect(second.getByLabel("Unread agent update")).toHaveCount(0);
    // A retained but hidden chat must still notify and remain unread.
    await opened.getByRole("button", { name: "Tab 1", exact: true }).click();
    await control.requestAgent({ kind: "send", sessionId: id, text: "question" }, randomUUID());
    await expect.poll(count).toBe(2);
    await expect.poll(() => control.agents.find((a) => a.id === id)?.attention?.seen).toBe(false);
    // Reload both windows: old attention must not replay.
    await page.reload();
    await second.reload();
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await second.getByRole("button", { name: /^Account:/ }).click();
    await second.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await expect.poll(count).toBe(0);
    // A new turn invalidates the old attention and closes any outstanding browser notice.
    const pending = control.agents.find((a) => a.id === id)?.pending[0];
    assert(pending);
    await control.requestAgent(
      {
        kind: "respond",
        sessionId: id,
        pendingId: pending.id,
        answers: { color: ["Blue"] },
      },
      randomUUID(),
    );
    await expect.poll(count).toBe(1);
    await control.requestAgent({ kind: "send", sessionId: id, text: "hold" }, randomUUID());
    await expect(page.getByLabel("Unread agent update")).toHaveCount(0);
    await expect(second.getByLabel("Unread agent update")).toHaveCount(0);
    await expect
      .poll(async () => {
        for (const p of context.pages()) {
          if (
            await p.evaluate(() =>
              (Notification as unknown as { records: { closed: boolean }[] }).records.some(
                (r) => !r.closed,
              ),
            )
          )
            return false;
        }
        return true;
      })
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    control.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
