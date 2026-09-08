import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

import { signedIn } from "./signed-in.ts";
test("shared chat streams, reloads, handles approvals and remains in global Agents", async ({
  page,
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-chat-browser-"));
  const context = await browser.newContext();
  const second = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  second.on("pageerror", (error) => errors.push(error.message));
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");
    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.getByLabel("Project name", { exact: true }).fill("Chat acceptance");
    await page.getByLabel("Folder on this machine").fill(directory);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await expect(page.getByLabel("Agent status: Ready").first()).toBeVisible();
    await page.getByLabel("Message Codex").fill("hold this stream");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from");
    await second.goto("http://localhost:1420");
    await expect(second.getByRole("log")).toContainText("Hello from");
    await second.reload();
    await expect(second.getByRole("log")).toContainText("hold this stream");
    await expect(
      second.getByRole("log").getByText("hold this stream", { exact: true }),
    ).toHaveCount(1);
    await second.getByRole("button", { name: "Interrupt agent", exact: true }).click();
    await expect(page.getByLabel("Agent status: Interrupted").first()).toBeVisible();
    await page.getByLabel("Message Codex").fill("approve command");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(second.getByRole("region", { name: "Allow command execution?" })).toBeVisible();
    await second.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(page.getByLabel("Agent status: Done").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
    await page.getByLabel("Message Codex").fill("question");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await second.getByRole("button", { name: "Blue", exact: true }).click();
    await second.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(page.getByLabel("Agent status: Done").first()).toBeVisible();
    await page.getByRole("button", { name: "Close pane", exact: true }).click();
    await page
      .getByRole("region", { name: "Agents", exact: true })
      .getByRole("list")
      .getByRole("button")
      .first()
      .click();
    await expect(page.getByRole("log")).toContainText("hold this stream");
    await page.getByLabel("Message Codex").fill("hello again");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from Codex");
    await page.screenshot({ path: "test-results/chat.png" });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
