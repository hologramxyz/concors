import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("the sidebar highlights only the open page, and its + leaves that page alone", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-sidebar-nav-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Nav project", directory);
    const row = (name: string) =>
      page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name, exact: true });
    const background = (name: string) =>
      row(name).evaluate((element) => getComputedStyle(element).backgroundColor);
    const open = async (name: "Schedules" | "Pull requests") => {
      await row(name).click();
      await page.mouse.move(800, 500);
      await expect(page.getByRole("heading", { name, level: 2, exact: true })).toBeVisible();
    };
    const plain = await background("Schedules");

    await open("Pull requests");
    await expect(row("Pull requests")).toHaveAttribute("aria-current", "page");
    await expect(row("Schedules")).not.toHaveAttribute("aria-current", "page");
    expect(await background("Pull requests")).not.toBe(plain);

    await page.getByRole("button", { name: "Open resources", exact: true }).click();
    await page.mouse.move(800, 500);
    await expect(page.getByRole("heading", { name: "Resources", level: 2 })).toBeVisible();
    await expect(page.locator('#app-sidebar [aria-current="page"]')).toHaveCount(0);
    expect(await background("Pull requests")).toBe(plain);

    await open("Schedules");
    await expect(row("Pull requests")).not.toHaveAttribute("aria-current", "page");

    // Opening and dismissing the menu, from each page, is not a way to navigate.
    const heading = page.locator("main h2").first();
    for (const name of ["Schedules", "Pull requests"] as const) {
      await open(name);
      const add = page.getByRole("button", { name: "Open workspace menu", exact: true });
      await add.click();
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(heading).toHaveText(name);
      await page.keyboard.press("Escape");
      await add.dblclick();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(heading).toHaveText(name);
      await expect(row(name)).toHaveAttribute("aria-current", "page");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("without GitHub repositories, Pull requests is only its empty state", async ({ page }) => {
  await signedIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Pull requests", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No GitHub repositories yet" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Pull request state" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
});

test("the sidebar shows no count of active schedules", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-schedule-count-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Count project", directory);
    const nav = page.getByRole("button", { name: "Schedules", exact: true });
    await nav.click();
    await page.getByRole("button", { name: "New schedule", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Counted");
    await dialog.getByRole("combobox", { name: "Provider", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Codex", exact: true }).click();
    await dialog.getByLabel("Prompt", { exact: true }).fill("Review recent commits");
    await dialog.getByRole("button", { name: "Create schedule", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Counted", exact: true })).toBeVisible();
    await expect(nav).toHaveText("Schedules");
    await page.getByRole("button", { name: "Delete Counted", exact: true }).click();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No schedules yet" })).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
