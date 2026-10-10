import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("a queued follow-up can steer the running turn instead of waiting for it", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-steer-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Steering", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    // "hold" keeps the turn running, so the next message is a follow-up.
    await composer.fill("Refactor the parser, hold");
    await composer.press("Enter");
    await expect(page.getByRole("button", { name: "Interrupt agent" })).toBeEnabled();
    await composer.fill("Also update the docs");
    await composer.press("Enter");

    const queue = page.locator("[data-composer-queue]");
    const followUp = queue.getByText("Also update the docs", { exact: true });
    await expect(followUp).toBeVisible();
    await queue.getByRole("button", { name: "Steer", exact: true }).click();

    await expect(followUp).toHaveCount(0);
    const log = page.getByRole("log", { name: "Chat timeline" });
    await expect(log).toContainText("Also update the docs");
    // Still the same turn: steering does not stop or restart the agent.
    await expect(page.getByRole("button", { name: "Interrupt agent" })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
