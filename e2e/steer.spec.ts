import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("Enter steers the running turn, ⌘/Ctrl+Enter queues, and a queued follow-up can steer", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-steer-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Steering", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    // "hold" keeps the turn running, so every next message is a follow-up.
    await composer.fill("Refactor the parser, hold");
    await composer.press("Enter");
    const interrupt = page.getByRole("button", { name: "Interrupt agent" });
    await expect(interrupt).toBeEnabled();
    const log = page.getByRole("log", { name: "Chat timeline" });
    const queue = page.locator("[data-composer-queue]");

    // By default Enter steers, as the Codex app's Follow-ups setting does.
    await expect(composer).toHaveAttribute("placeholder", "Steer the current turn…");
    await composer.fill("Keep the public API");
    await expect(page.locator("[data-follow-up-hint]")).toContainText("Enter steers");
    await expect(page.getByRole("button", { name: "Steer message", exact: true })).toBeVisible();
    await composer.press("Enter");
    await expect(log).toContainText("Keep the public API");
    await expect(queue).toHaveCount(0);
    await expect(interrupt).toBeEnabled();

    // A message with an attachment steers too, rather than waiting in the queue.
    await page.getByLabel("Upload files").setInputFiles({
      name: "shot.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    await composer.fill("i mean for this");
    await expect(page.getByRole("button", { name: "Steer message", exact: true })).toBeVisible();
    await composer.press("Enter");
    await expect(log).toContainText("i mean for this");
    await expect(log.locator("[data-message-attachments]").last()).toBeVisible();
    await expect(queue).toHaveCount(0);
    await expect(interrupt).toBeEnabled();

    // The other way queues it, and a queued follow-up can still steer.
    await composer.fill("Also update the docs");
    await composer.press("ControlOrMeta+Enter");
    const followUp = queue.getByText("Also update the docs", { exact: true });
    await expect(followUp).toBeVisible();
    await queue.getByRole("button", { name: "Steer", exact: true }).click();
    await expect(followUp).toHaveCount(0);
    await expect(log).toContainText("Also update the docs");
    await expect(interrupt).toBeEnabled();

    // Chosen in Settings, Enter queues instead and ⌘/Ctrl+Enter steers.
    await page.keyboard.press("Control+Shift+Slash");
    await expect(page.getByRole("heading", { name: "Shortcuts", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Follow-ups", exact: true }).click();
    await page.getByRole("menuitem", { name: "Queue for after the turn" }).click();
    await expect(page.getByRole("button", { name: "Follow-ups", exact: true })).toHaveText(
      "Queue for after the turn",
    );
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(composer).toBeVisible();
    await composer.fill("Then run the tests");
    await expect(page.getByRole("button", { name: "Queue message", exact: true })).toBeVisible();
    await composer.press("Enter");
    await expect(queue.getByText("Then run the tests", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
