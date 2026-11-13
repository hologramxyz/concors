import { test, expect, signedIn } from "./signed-in.ts";
import { chooseProvider } from "./support/agents.ts";

test("Supervisor uses the unified chat and retains its selected harness after navigation and reload", async ({
  page,
}) => {
  test.setTimeout(60000);
  await signedIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Supervisor", exact: true }).click();
  await expect(page.getByTestId("supervisor-page")).toBeVisible();
  await chooseProvider(page);
  await page
    .getByRole("textbox", { name: "Message Codex", exact: true })
    .fill("Find context across my workspaces");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Hello from");
  await page.screenshot({ path: test.info().outputPath("supervisor-desktop.png") });
  await page.getByRole("button", { name: "Agent and model", exact: true }).click();
  await page.getByRole("button", { name: "Back to providers", exact: true }).click();
  await page.getByRole("option", { name: /^Claude Code( |$)/ }).click();
  await page.getByRole("option").first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start new conversation", exact: true })
    .click();
  await expect(page.getByTestId("supervisor-page")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Claude Code", exact: true })
    .fill("Coordinate two projects");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Coordinate two projects");
  await page.getByRole("button", { name: "Schedules", exact: true }).click();
  await page.getByRole("button", { name: "Supervisor", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Claude Code", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Supervisor", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Claude Code", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Agent and model", exact: true }).click();
  await page.getByRole("button", { name: "Back to providers", exact: true }).click();
  await page.getByRole("option", { name: /^Codex( |$)/ }).click();
  await page.getByRole("option").first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Switch to Codex", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText("Find context across my workspaces");
  await expect(page.getByRole("log")).not.toContainText("Coordinate two projects");
  // Verify the restored session can continue. Supervisor survives workspace cleanup, so leave
  // Codex as the most recently used harness for the following specs on this shared daemon.
  await page
    .getByRole("textbox", { name: "Message Codex", exact: true })
    .fill("Continue the original conversation");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Continue the original conversation");
  await expect(page.getByRole("log").getByText("Hello from Codex", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
