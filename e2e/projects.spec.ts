import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("create and clone projects on the daemon machine and sync to another browser", async ({
  page,
  browser,
}) => {
  const root = mkdtempSync(join(tmpdir(), "concors-browser-projects-"));
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await page.goto("/");
    await second.goto("http://localhost:1420");
    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.getByLabel("Project source").selectOption("create");
    await page.getByLabel("Project name", { exact: true }).fill("Created from browser");
    await page.getByLabel("Folder on this machine").fill(join(root, "created"));
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await expect(
      second.getByRole("heading", { name: "Created from browser", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.getByLabel("Project source").selectOption("clone");
    await page.getByLabel("Project name", { exact: true }).fill("Cloned from browser");
    await page.getByLabel("Repository URL or local path").fill(process.cwd());
    await page.getByLabel("Folder on this machine").fill(join(root, "cloned"));
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await expect(
      second.getByRole("heading", { name: "Cloned from browser", exact: true }),
    ).toBeVisible();
    expect(readFileSync(join(root, "cloned", "README.md"), "utf8")).toContain("Concors");
    await second.reload();
    await second.getByRole("button", { name: "Add project", exact: true }).first().click();
    await expect(second.getByRole("region", { name: "Project setup history" })).toContainText(
      "Cloned from browser · done",
    );
  } finally {
    await context.close();
    rmSync(root, { recursive: true, force: true });
  }
});
