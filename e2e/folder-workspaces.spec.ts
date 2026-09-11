import { test, expect, signedIn } from "./signed-in.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

async function cd(page: Page, pane: Locator, directory: string) {
  await pane.locator("textarea").focus();
  await page.keyboard.type(`cd '${directory.replaceAll("'", "'\\''")}'`);
  await page.keyboard.press("Enter");
}
test("new workspaces follow the original shell, inherit folders and preserve open files", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const root = mkdtempSync(join(tmpdir(), "concors-folder-flow-"));
  const repo = join(root, "folder-flow"),
    other = join(root, "another-folder"),
    src = join(repo, "src");
  mkdirSync(src, { recursive: true });
  mkdirSync(other);
  execFileSync("git", ["init", repo], { stdio: "ignore" });
  writeFileSync(join(repo, "same.ts"), "const original = 1;\n");
  writeFileSync(join(other, "same.ts"), "const other = 2;\n");
  writeFileSync(join(other, "only-here.txt"), "other folder");
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await signedIn(page);
    await signedIn(second);
    await page.goto("/");
    await second.goto(test.info().project.use.baseURL ?? "http://localhost:1420");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Open workspace menu", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "New workspace", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const panes = page.getByRole("region", { name: "Terminal pane", exact: true });
    await expect(panes).toHaveCount(1);
    await cd(page, panes.first(), src);
    await expect(page.getByRole("heading", { name: "folder-flow", exact: true })).toBeVisible();
    await expect(second.getByRole("heading", { name: "folder-flow", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Toggle project files" }).click();
    const tree = page.getByRole("complementary", { name: "Project files" });
    await tree.getByRole("button", { name: "same.ts", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Code editor: same.ts" });
    await editor.fill("const original = 3;\n");
    await page.getByRole("button", { name: "Tab 1", exact: true }).click();
    await panes.first().getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally", exact: true }).click();
    await expect(panes).toHaveCount(2);
    await panes.last().locator("textarea").focus();
    await page.keyboard.type("pwd");
    await page.keyboard.press("Enter");
    await expect(panes.last().getByLabel("Terminal output")).toContainText(src);
    await cd(page, panes.last(), other);
    await expect(panes.last().getByLabel("Terminal output")).toContainText(other);
    // A background split never takes over the workspace's identity.
    await page.waitForTimeout(650);
    await expect(page.getByRole("heading", { name: "folder-flow", exact: true })).toBeVisible();
    await cd(page, panes.first(), other);
    await expect(page.getByRole("heading", { name: "another-folder", exact: true })).toBeVisible();
    await expect(tree.getByRole("button", { name: "only-here.txt", exact: true })).toBeVisible();
    await page
      .getByLabel("Project tabs")
      .getByRole("button", { name: /^same.ts/, pressed: false })
      .click();
    await expect(editor).toContainText("const original = 3");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => readFileSync(join(repo, "same.ts"), "utf8")).toContain("original = 3");
    expect(readFileSync(join(other, "same.ts"), "utf8")).toContain("other = 2");
    await tree.getByRole("button", { name: "same.ts", exact: true }).click();
    await expect(editor).toContainText("const other = 2");
    await expect(page.getByRole("button", { name: /^same.ts/ })).toHaveCount(3); // two tabs and one file tree entry
    await page.getByRole("button", { name: "Tab 1", exact: true }).click();
    await cd(page, panes.first(), src);
    await expect(page.getByRole("heading", { name: "folder-flow", exact: true })).toBeVisible();
    await second.reload();
    await expect(second.getByRole("heading", { name: "folder-flow", exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/folder-workspaces-desktop.png" });
    expect(
      await page
        .locator(".sidebar-shell nav")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgb(226, 225, 219)");
  } finally {
    await context.close();
    rmSync(root, { recursive: true, force: true });
  }
});
