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
    const agentList = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("region", { name: "Agents", exact: true });
    await expect(agentList.getByRole("img", { name: "Agent status: Ready" })).toBeVisible();
    await expect(agentList.getByText("Chat acceptance", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Message Codex")).toBeEnabled();
    await expect(page.getByRole("log")).toBeEmpty();
    await expect(page.getByText("Start a conversation", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Agent pane", exact: true }).locator("header .truncate"),
    ).toHaveText(
      await agentList
        .getByRole("list")
        .getByRole("button")
        .first()
        .locator(".truncate")
        .innerText(),
    );
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await agentList.getByRole("list").getByRole("button").first().click();
    await expect(page.getByRole("heading", { name: "Chat acceptance", exact: true })).toBeVisible();
    await expect(page.getByLabel("Message Codex")).toBeFocused();
    await expect(page.getByRole("complementary", { name: "Agent sessions" })).toHaveCount(0);
    await page.getByLabel("Message Codex").fill("hold this stream");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from");
    const status = agentList
      .getByRole("button", { name: /hold this stream/ })
      .getByRole("img", { name: "Agent status: Working" });
    await expect(status).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Agent pane", exact: true }).locator("header .truncate"),
    ).toHaveText("hold this stream");
    await expect(status.locator("svg")).toHaveCSS("animation-name", "spin");
    const row = agentList.getByRole("list").getByRole("button").first();
    expect((await row.boundingBox())?.height).toBeLessThanOrEqual(28);
    await expect(row.locator(".truncate")).toHaveCSS("white-space", "nowrap");
    await expect(row.locator(".truncate")).toHaveCSS("text-overflow", "ellipsis");

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
    await expect(row.getByRole("img", { name: "Agent status: Done" })).toBeVisible();
    await expect(page.getByText(/^Worked for /)).toBeVisible();
    await expect(page.getByText(/^Completed ·/)).toHaveCount(0);
    await expect(page.getByLabel("Elapsed time", { exact: true })).toHaveCount(0);
    await expect(agentList.getByRole("img").locator("svg")).toHaveCount(0);

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
    const replyFooter = page.getByRole("article").filter({ hasText: "Hello from Codex" }).last();
    await expect(replyFooter.getByText(/^Worked for /)).toBeVisible();
    await expect(
      replyFooter.getByRole("button", { name: "Copy message", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/chat.png" });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
