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
  await chooseProvider(page, "Claude Code");
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
  await chooseProvider(page);
  await expect(page.getByRole("log")).toContainText("Find context across my workspaces");
  await expect(page.getByRole("log")).not.toContainText("Coordinate two projects");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
