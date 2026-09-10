import { test, expect, signedIn } from "./signed-in.ts";
import { openFolder } from "./support/projects.ts";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

test("browse and clone folders on the machine, derive names, and focus an existing workspace", async ({
  page,
  browser,
}) => {
  const root = mkdtempSync(join(tmpdir(), "concors-browser-projects-"));
  const folder = join(root, "my-project");
  mkdirSync(folder);
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");
    await second.goto(test.info().project.use.baseURL ?? "http://localhost:1420");
    await openFolder(page, folder);
    await expect(second.getByRole("heading", { name: "my-project", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Clone repository…", exact: true }).click();
    await page.getByLabel("Repository URL or local path").fill(process.cwd());
    await expect(page.getByLabel("Destination folder")).toHaveValue(
      `~/repos/${basename(process.cwd())}`,
    );
    await page.getByLabel("Destination folder").fill(join(root, "cloned"));
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Clone repository", exact: true })
      .click();
    await expect(second.getByRole("heading", { name: "cloned", exact: true })).toBeVisible();
    expect(readFileSync(join(root, "cloned", "README.md"), "utf8")).toContain("Concors");
    await openFolder(page, folder);
    await expect(second.getByRole("heading", { name: "my-project", exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("button", { name: "my-project", exact: true }),
    ).toHaveCount(1);
    await second.reload();
    await expect(second.getByRole("heading", { name: "my-project", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open folder…", exact: true }).click();
    await expect(page.getByLabel("Folder path", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Go", exact: true })).toBeEnabled();
    await page.getByLabel("Folder path", { exact: true }).fill(root);
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await page.getByRole("button", { name: "my-project", exact: true }).last().click();
    await expect(page.getByLabel("Folder path", { exact: true })).toHaveValue(folder);
    await expect(page.getByRole("dialog")).not.toContainText("Project name");
    const size = await page.getByRole("dialog").evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
      right: element.getBoundingClientRect().right,
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.width);
    expect(size.right).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "test-results/folders-mobile.png" });
  } finally {
    await context.close();
    rmSync(root, { recursive: true, force: true });
  }
});
