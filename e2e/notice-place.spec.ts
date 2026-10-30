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

test("an agent's notice names its workspace and tab apart from what the agent was doing", async ({
  page,
  context,
}) => {
  const first = await mkdtemp(join(tmpdir(), "concors-notice-a-"));
  const second = await mkdtemp(join(tmpdir(), "concors-notice-b-"));
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "notice place", version: "0.0.0" },
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

    await seedProject(page, "Marketing", first);
    await page.getByRole("button", { name: "Marketing", exact: true }).click();
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    // A tab nobody named is left out of the notice, which already names the chat; a named one
    // is shown.
    await tab(page, 1).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename tab", exact: true }).click();
    await page.getByLabel("Tab name", { exact: true }).fill("Launch");
    await page.keyboard.press("Enter");
    await expect(tab(page, 1)).toHaveText("Launch");
    await expect
      .poll(() => control.workspace?.projects.find((p) => p.directory === first)?.id)
      .toBeTruthy();
    const project = control.workspace?.projects.find((p) => p.directory === first);
    assert(project);
    await expect.poll(() => control.agents.some((a) => a.projectId === project.id)).toBe(true);
    const agent = control.agents.find((a) => a.projectId === project.id);
    assert(agent);

    await seedProject(page, "Engineering", second);
    await page.getByRole("button", { name: "Engineering", exact: true }).click();
    await control.requestAgent({ kind: "send", sessionId: agent.id, text: "hello" }, randomUUID());

    const notices = page.getByRole("complementary", { name: "Agent notifications" });
    const place = notices.locator("[data-notice-place]");
    // The pointer on the card holds it past its five seconds, however slow the checks below are.
    await place.hover();
    await expect(place).toHaveText("MarketingLaunch");
    await expect(place).toHaveAttribute("title", "Marketing › Launch");
    await expect(notices).toContainText("Agent finished");
    await notices.screenshot({ path: test.info().outputPath("notice-place.png") });
    await notices.getByRole("button", { name: /Marketing/ }).click();
    await expect(page.getByRole("log")).toContainText("Hello from Codex");
    await expect(place).toHaveCount(0);
  } finally {
    control.disconnect();
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});
