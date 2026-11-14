import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

async function pick(dialog: Locator, field: string, option: string) {
  await dialog.getByRole("combobox", { name: field, exact: true }).click();
  await dialog.page().getByRole("menuitemradio", { name: option, exact: true }).click();
}

/** A badge with a little of what surrounds it, in both themes, for comparing them. */
async function badgeShots(page: Page, badge: Locator, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForTimeout(400);
    const area = await badge.boundingBox();
    if (!area) throw new Error(`${name} has no box`);
    await page.screenshot({
      path: test.info().outputPath(`badge-${name}-${colorScheme}.png`),
      clip: { x: area.x - 40, y: area.y - 14, width: area.width + 80, height: area.height + 28 },
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

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
    await pick(dialog, "Provider", "Codex");
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
    await badgeShots(page, card.locator('[data-slot="badge"]', { hasText: "Active" }), "active");
    await page.getByRole("button", { name: "Pause Daily review", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Resume Daily review", exact: true }),
    ).toBeEnabled();
    await expect(card.getByText("Paused", { exact: true })).toBeVisible();
    await expect(card.locator('[data-slot="badge"]', { hasText: "Paused" })).toBeVisible();
    await badgeShots(page, card.locator('[data-slot="badge"]', { hasText: "Paused" }), "paused");
    await expect(card.getByText("No upcoming runs")).toHaveCount(0);
    await page.getByRole("button", { name: "Edit Daily review", exact: true }).click();
    await dialog.getByLabel("Name", { exact: true }).fill("Weekly review");
    await pick(dialog, "Repeat", "Weekly");
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
    await expect(dialog.getByRole("heading")).toHaveText("Delete “Weekly review”?");
    await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveText(
      "This can’t be undone.",
    );
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No schedules yet" })).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a schedule's files are uploaded, kept, edited and sent with each run", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-schedule-files-"));
  const file = (name: string, text: string) => ({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(text),
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Job search", directory);
    await page.getByRole("button", { name: "Schedules", exact: true }).click();
    await page.getByRole("button", { name: "New schedule", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Find internships");
    await pick(dialog, "Provider", "Codex");
    await dialog.getByLabel("Model", { exact: true }).fill("fixture");
    await dialog.getByLabel("Prompt", { exact: true }).fill("Apply to new internships");
    await expect(dialog.getByText(/^Sent with every run/)).toBeVisible();
    const files = dialog.getByRole("list", { name: "Files" });
    const picker = dialog.getByLabel("Choose files to attach");
    await picker.setInputFiles([file("resume.pdf", "my resume"), file("draft.pdf", "draft")]);
    await expect(files.getByRole("listitem")).toHaveCount(2);
    await expect(files.getByRole("listitem").first()).toContainText("resume.pdf9 B");
    await dialog.getByRole("button", { name: "Remove draft.pdf", exact: true }).click();
    await expect(files.getByRole("listitem")).toHaveText(["resume.pdf9 B"]);
    await page.screenshot({ path: test.info().outputPath("schedule-files-form.png") });
    await dialog.getByRole("button", { name: "Create schedule", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    // The edit form lists what the schedule keeps; a file added and saved joins it.
    await page.getByRole("button", { name: "Edit Find internships", exact: true }).click();
    await expect(files.getByRole("listitem")).toHaveText(["resume.pdf9 B"]);
    await picker.setInputFiles([file("letter.pdf", "cover letter")]);
    await expect(files.getByRole("listitem")).toHaveText(["resume.pdf9 B", "letter.pdf12 B"]);
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    await page.getByRole("button", { name: "Run Find internships now", exact: true }).click();
    await page.getByText("Recent runs", { exact: true }).click();
    await expect(page.getByRole("article").getByRole("status")).toHaveText("Done");
    await page.getByRole("button", { name: "Open agent", exact: true }).click();
    const log = page.getByRole("log");
    await expect(log).toContainText("Apply to new internships");
    await expect(log).toContainText("resume.pdf");
    await expect(log).toContainText("letter.pdf");
    await page.screenshot({ path: test.info().outputPath("schedule-files-run.png") });

    // Removing one in an edit takes it off the schedule.
    await page.getByRole("button", { name: "Schedules", exact: true }).click();
    await page.getByRole("button", { name: "Edit Find internships", exact: true }).click();
    await dialog.getByRole("button", { name: "Remove letter.pdf", exact: true }).click();
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Edit Find internships", exact: true }).click();
    await expect(files.getByRole("listitem")).toHaveText(["resume.pdf9 B"]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    // The machine is shared with the tests after this one, which start with no schedules.
    await page.getByRole("button", { name: "Delete Find internships", exact: true }).click();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
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
    const tabs = await page.locator("[data-workspace-tab-row]").boundingBox();
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

test("the schedule form keeps to its labels and to the window", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-schedule-form-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Form project", directory);
    await page.getByRole("button", { name: "Schedules", exact: true }).click();
    await page.getByRole("button", { name: "New schedule", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("select")).toHaveCount(0);
    await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveCount(0);
    await expect(dialog.getByText(/known model|must stay on/)).toHaveCount(0);
    await expect
      .poll(async () => {
        const [menu, input] = await Promise.all([
          dialog.getByRole("combobox", { name: "Provider", exact: true }).boundingBox(),
          dialog.getByLabel("Model", { exact: true }).boundingBox(),
        ]);
        return [menu?.y, menu?.height].join() === [input?.y, input?.height].join();
      })
      .toBe(true);

    await dialog.getByRole("combobox", { name: "Workspace", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Form project", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toContainText(basename(directory));
    await page.keyboard.press("Escape");

    const enable = dialog.getByRole("checkbox", { name: "Enable schedule", exact: true });
    await expect(enable).toBeChecked();
    const row = dialog.locator("label").filter({ hasText: "Enable schedule" });
    const box = await row.boundingBox();
    await row.click({ position: { x: (box?.width ?? 1) - 4, y: (box?.height ?? 1) / 2 } });
    await expect(enable).not.toBeChecked();

    // Short enough that the weekly form cannot fit: the body scrolls, its ends stay.
    await page.setViewportSize({ width: 900, height: 420 });
    // Repeat now sits below the fold, under Files. Scrolled to as a person would: Playwright's own
    // scrolling also moves the dialog's clipped outer box, which then springs back under the menu.
    await dialog.locator(".chat-scroll").hover();
    await page.mouse.wheel(0, 400);
    await pick(dialog, "Repeat", "Weekly");
    await expect(dialog.getByRole("heading", { name: "New schedule" })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
    const scroller = dialog.locator(".chat-scroll");
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await enable.scrollIntoViewIfNeeded();
    await expect(enable).toBeInViewport();
    await expect(dialog.getByRole("heading", { name: "New schedule" })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
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
      await pick(dialog, "Provider", "Codex");
      await dialog.getByLabel("Prompt", { exact: true }).fill("Review recent commits");
      await dialog.getByLabel("At", { exact: true }).fill("17:30");
      await dialog.getByRole("button", { name: "Create schedule", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText("Daily at 17:30", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Delete Clock review", exact: true }).click();
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.getByRole("heading", { name: "No schedules yet" })).toBeVisible();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
