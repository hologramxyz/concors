import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("schedules create, run, reopen their agent, pause, edit and delete", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-schedule-ui-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Schedules", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No schedules yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New schedule", exact: true })).toBeDisabled();
    await page.reload();
    await seedProject(page, "Scheduled project", directory);
    await page.getByRole("button", { name: "Schedules", exact: true }).click();
    await page.getByRole("button", { name: "New schedule", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Daily review");
    await dialog.getByRole("combobox", { name: "Provider", exact: true }).selectOption("codex");
    await dialog.getByLabel("Model", { exact: true }).fill("fixture");
    await dialog.getByLabel("Prompt", { exact: true }).fill("Review recent commits");
    await dialog.getByLabel("Time zone", { exact: true }).fill("Europe/Rome");
    await dialog.getByRole("button", { name: "Create schedule", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Daily review", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Run Daily review now", exact: true }).click();
    await page.getByText("Recent runs · 1", { exact: true }).click();
    await expect(page.getByRole("article").getByRole("status")).toHaveText("Done");
    await page.screenshot({ path: test.info().outputPath("schedules-desktop.png") });
    await page.getByRole("button", { name: "Open agent", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Review recent commits");
    await expect(page.getByLabel("Scheduled agent")).toBeVisible();
    await page.getByRole("button", { name: "Schedules", exact: true }).click();
    await page.getByRole("button", { name: "Pause Daily review", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Resume Daily review", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Edit Daily review", exact: true }).click();
    await dialog.getByLabel("Name", { exact: true }).fill("Weekly review");
    await dialog.getByRole("combobox", { name: "Repeat", exact: true }).selectOption("weekly");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Schedules", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Weekly review", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete Weekly review", exact: true }).click();
    await dialog.getByRole("button", { name: "Delete schedule", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No schedules yet" })).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
