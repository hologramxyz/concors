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
    await expect(
      page.getByRole("heading", { level: 2, name: "Schedules", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Run your agents on a cadence.", { exact: true })).toBeVisible();
    await expect(page.getByText(/Set up a prompt here/)).toHaveCount(0);
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
    const card = page.getByRole("article");
    await expect(card.getByText("Scheduled project", { exact: true })).toBeVisible();
    await expect(card.getByText("Codex", { exact: true })).toBeVisible();
    await expect(card.getByText("Daily at 9:00 AM", { exact: true })).toBeVisible();
    await expect(card.getByText("Europe/Rome", { exact: true })).toBeVisible();
    await expect(page.getByText(/Schedules belong to this machine/)).toHaveCount(0);
    for (const [action, tooltip] of [
      ["Run Daily review now", "Run now"],
      ["Pause Daily review", "Pause"],
      ["Edit Daily review", "Edit"],
      ["Delete Daily review", "Delete"],
    ] as const) {
      await page.getByRole("button", { name: action, exact: true }).hover();
      await expect(page.getByRole("tooltip")).toHaveText(tooltip);
      await expect(page.locator('[data-slot="tooltip-content"] svg')).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Run Daily review now", exact: true }).click();
    await page.getByText("Recent runs", { exact: true }).click();
    await expect(card).not.toContainText("·");
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
    await expect(card.getByText("Paused", { exact: true })).toBeVisible();
    await expect(card.getByText("No upcoming runs")).toHaveCount(0);
    await page.getByRole("button", { name: "Edit Daily review", exact: true }).click();
    await dialog.getByLabel("Name", { exact: true }).fill("Weekly review");
    await dialog.getByRole("combobox", { name: "Repeat", exact: true }).selectOption("weekly");
    const time = dialog.getByLabel("At", { exact: true });
    await expect(time).toHaveValue("9:00 AM");
    await time.fill("nonsense");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Enter a time like 9:00 AM");
    await time.fill("5:30pm");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card.getByText("Weekdays at 5:30 PM", { exact: true })).toBeVisible();
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

test("pages without tabs start where a chat's content does, under an empty strip", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-page-strip-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Strip project", directory, { initialPane: "default" });
    const tabs = await page.locator('[data-tour="tabs"]').boundingBox();
    await page.getByRole("button", { name: "Schedules", exact: true }).click();
    const main = await page.getByRole("main").boundingBox();
    expect(main?.y).toBe((tabs?.y ?? 0) + (tabs?.height ?? 0));
    const strip = page.getByRole("banner");
    await expect(strip).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
    await expect(strip.getByRole("heading")).toHaveClass(/sr-only/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.describe("on a 24-hour clock", () => {
  test.use({ locale: "en-GB" });
  test("schedule times follow it on the card and in the form", async ({ page }) => {
    const directory = await mkdtemp(join(tmpdir(), "concors-schedule-clock-"));
    try {
      await signedIn(page);
      await page.goto("/");
      await seedProject(page, "Clock project", directory);
      await page.getByRole("button", { name: "Schedules", exact: true }).click();
      await page.getByRole("button", { name: "New schedule", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("At", { exact: true })).toHaveValue("9:00");
      await dialog.getByLabel("Name", { exact: true }).fill("Clock review");
      await dialog.getByRole("combobox", { name: "Provider", exact: true }).selectOption("codex");
      await dialog.getByLabel("Prompt", { exact: true }).fill("Review recent commits");
      await dialog.getByLabel("At", { exact: true }).fill("17:30");
      await dialog.getByRole("button", { name: "Create schedule", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText("Daily at 17:30", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Delete Clock review", exact: true }).click();
      await dialog.getByRole("button", { name: "Delete schedule", exact: true }).click();
      await expect(page.getByRole("heading", { name: "No schedules yet" })).toBeVisible();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
