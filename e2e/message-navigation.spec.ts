import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("sent-message rail previews and jumps through paginated history, with a narrow-pane list", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-message-nav-"));
  const connection = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "navigation", version: "0.0.0" },
  });
  const off = connection.subscribeWorkspace(() => undefined);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await connection.connect();
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Message navigation", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Message Codex" });
    await expect(input).toBeEnabled();
    await expect
      .poll(() => connection.agents.find((a) => a.directory === directory)?.status)
      .toBe("idle");
    const sessionId = connection.agents.find((a) => a.directory === directory)!.id;
    const send = async (text: string) => {
      const result = await connection.requestAgent(
        { kind: "send", sessionId, text },
        crypto.randomUUID(),
      );
      expect(result.outcome.status).toBe("ok");
      await expect
        .poll(() => connection.agents.find((a) => a.id === sessionId)?.status)
        .toBe("done");
    };
    for (let i = 1; i <= 36; i++)
      await send(`Request ${i}: inspect the project and explain the result`);
    // Reload starts with one timeline page, but all prompts should remain indexed.
    await page.reload();
    const nav = page.getByRole("navigation", { name: "Your messages", exact: true });
    await expect(nav.getByRole("button")).toHaveCount(36);
    await expect(
      page
        .getByRole("log")
        .getByText("Request 1: inspect the project and explain the result", { exact: true }),
    ).toHaveCount(0);
    const first = nav.getByRole("button", { name: /^Message 1 of 36:/ });
    const target = page
      .getByRole("log")
      .getByText("Request 1: inspect the project and explain the result", { exact: true });
    const slot = first.locator("..");
    const before = await first.locator("span").evaluate((el) => el.getBoundingClientRect().width);
    await first.hover();
    await expect(slot.locator(".message-rail-preview")).toContainText("Request 1:");
    await expect
      .poll(() => first.locator("span").evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(before);
    await page.screenshot({ path: test.info().outputPath("message-rail-hover.png") });
    await first.click();
    await expect(target).toBeInViewport();
    await expect(first).toHaveAttribute("aria-current", "location");
    // A new turn must not pull the reader back to the bottom after a jump.
    await send("Request 37: keep working while I read earlier messages");
    await expect(target).toBeInViewport();
    await expect(nav.getByRole("button")).toHaveCount(37);
    const firstUpdated = nav.getByRole("button").first();
    await firstUpdated.focus();
    await firstUpdated.press("End");
    await expect(nav.getByRole("button").last()).toBeFocused();
    await nav.getByRole("button").last().press("Enter");
    await expect(
      page
        .getByRole("log")
        .getByText("Request 37: keep working while I read earlier messages", { exact: true }),
    ).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(nav).not.toBeVisible();
    await page.getByRole("button", { name: "Browse your messages" }).click();
    const dialog = page.getByRole("dialog", { name: "Your messages", exact: true });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("message-list-mobile.png") });
    await dialog.getByRole("button", { name: /^1 Request 1:/ }).click();
    await expect(dialog).not.toBeVisible();
    await expect(target).toBeInViewport();
    const dimensions = await page
      .locator("body")
      .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    expect(errors).toEqual([]);
  } finally {
    off();
    connection.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
