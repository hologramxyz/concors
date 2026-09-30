import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

test("shared chat streams, handles approvals and removes detached sidebar entries", async ({
  page,
  browser,
}) => {
  // Two clients and repeated reloads need room beyond the short interaction-test budget.
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-chat-browser-"));
  const context = await browser.newContext();
  const second = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  second.on("pageerror", (error) => errors.push(error.message));
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");
    await seedProject(page, "Chat acceptance", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await expect(page.getByLabel("Agent status: Ready").first()).toBeVisible();
    const agentList = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("region", { name: "Agents", exact: true });
    await expect(agentList.getByRole("img", { name: "Agent status: Ready" })).toBeVisible();
    await expect(agentList.getByText("Chat acceptance", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Choose an agent" })).toHaveCount(0);
    // No messages or placeholder text: an empty chat only offers to resume an earlier session.
    await expect(page.getByRole("log")).toHaveText("Resume session");
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
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await agentList.getByRole("list").getByRole("button").first().click();
    await expect(page.getByRole("heading", { name: "Chat acceptance", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeFocused();
    await expect(page.getByRole("complementary", { name: "Agent sessions" })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Message Codex" }).fill("hold this stream");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from");
    const status = agentList
      .getByRole("button", { name: /hold this stream/ })
      .getByRole("img", { name: "Agent status: Working" });
    await expect(status).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Agent pane", exact: true }).locator("header .truncate"),
    ).toHaveText("hold this stream");
    await expect(status.locator("svg g")).toHaveCSS("animation-name", "spin");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(status.locator("svg g")).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const row = agentList.getByRole("list").getByRole("button").first();
    expect((await row.boundingBox())?.height).toBeLessThanOrEqual(28);
    await expect(row.locator(".truncate")).toHaveCSS("white-space", "nowrap");
    await expect(row.locator(".truncate")).toHaveCSS("text-overflow", "ellipsis");

    await second.goto(test.info().project.use.baseURL ?? "http://localhost:1420");
    await expect(second.getByRole("log")).toContainText("Hello from");
    await second.reload();
    await expect(second.getByRole("log")).toContainText("hold this stream");
    await expect(
      second.getByRole("log").getByText("hold this stream", { exact: true }),
    ).toHaveCount(1);
    await second.getByRole("button", { name: "Interrupt agent", exact: true }).click();
    await expect(page.getByLabel("Agent status: Interrupted").first()).toBeVisible();
    await page.getByRole("textbox", { name: "Message Codex" }).fill("approve command");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(second.getByRole("region", { name: "Allow command execution?" })).toBeVisible();
    await second.getByRole("button", { name: "Decline", exact: true }).click();
    // The open chat has seen its finished turn, so it reads as Ready rather than Done.
    await expect(page.getByText(/^Worked for /)).toBeVisible();
    await expect(page.getByLabel("Agent status: Ready").first()).toBeVisible();
    await expect(row.getByRole("img", { name: "Agent status: Ready" })).toBeVisible();
    await expect(page.getByText(/^Completed ·/)).toHaveCount(0);
    await expect(page.getByLabel("Elapsed time", { exact: true })).toHaveCount(0);
    await expect(agentList.locator("[data-agent-status-badge] svg")).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Message Codex" }).fill("question");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await second.getByRole("radio", { name: "Blue Use blue", exact: true }).click();
    await second.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(page.getByText(/^Worked for /)).toHaveCount(2);
    await expect(page.getByLabel("Agent status: Ready").first()).toBeVisible();
    await page.getByRole("textbox", { name: "Message Codex" }).fill("hello again");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from Codex");
    const replyFooter = page.getByRole("article").filter({ hasText: "Hello from Codex" }).last();
    await expect(replyFooter.getByText(/^Worked for /)).toBeVisible();
    await expect(
      replyFooter.getByRole("button", { name: "Copy message", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitemradio", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".xterm").filter({ visible: true })).toBeVisible();
    await expect(agentList.getByRole("list").getByRole("button")).toHaveCount(0);
    const remoteAgents = second.getByRole("region", { name: "Agents", exact: true });
    await expect(remoteAgents.getByRole("list").getByRole("button")).toHaveCount(0);
    await second.reload();
    await expect(remoteAgents.getByRole("list").getByRole("button")).toHaveCount(0);
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitemradio", { name: "Agent", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect(agentList.getByRole("list").getByRole("button")).toHaveCount(1);
    await page.getByRole("button", { name: "Close pane", exact: true }).click();
    await expect(agentList.getByRole("list").getByRole("button")).toHaveCount(0);
    await expect(remoteAgents.getByRole("list").getByRole("button")).toHaveCount(0);
    await second.reload();
    await expect(remoteAgents.getByRole("list").getByRole("button")).toHaveCount(0);
    await page.screenshot({ path: "test-results/chat.png" });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
