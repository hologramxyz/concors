import { test, expect } from "@playwright/test";
import { signedIn } from "./signed-in.ts";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

async function project(page: Page) {
  const root = mkdtempSync(join(tmpdir(), "concors-file-ui-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "main.ts"), "export const answer = 42;\nconsole.log(answer);\n");
  writeFileSync(
    join(root, "README.md"),
    "# Project files\n\nOpen [the source](src/main.ts#L2).\n\n<script>window.bad = true</script>\n",
  );
  writeFileSync(join(root, "example.ts"), "const example = true;\n");
  await signedIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add project", exact: true }).first().click();
  await page.getByLabel("Project source").selectOption("open");
  await page.getByLabel("Project name", { exact: true }).fill("File browser test");
  await page.getByLabel("Folder on this machine").fill(root);
  await page.getByRole("dialog").getByRole("button", { name: "Add project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "File browser test", exact: true })).toBeVisible();
  return root;
}
async function openSource(page: Page) {
  await page.getByRole("button", { name: "Toggle project files" }).click();
  const tree = page.getByRole("complementary", { name: "Project files" });
  await tree.getByRole("button", { name: "src", exact: true }).click();
  await tree.getByRole("button", { name: "main.ts", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Code editor: src/main.ts" })).toBeVisible();
  return tree;
}

test("browse, edit, preserve drafts across file tabs, preview Markdown and follow links", async ({
  page,
}) => {
  const root = await project(page);
  try {
    const tree = await openSource(page);
    const code = page.getByRole("textbox", { name: "Code editor: src/main.ts" });
    await code.fill("export const answer = 43;\nconsole.log(answer);\n");
    await tree.getByRole("button", { name: "README.md", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Project files" })).toBeVisible();
    await page.getByRole("link", { name: "the source" }).click();
    await expect(code).toContainText("43");
    await expect(page.getByRole("button", { name: /^main.ts/, pressed: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => readFileSync(join(root, "src/main.ts"), "utf8")).toContain("43");
    await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
    await code.fill("manual draft");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Close src/main.ts file" }).click();
    await expect(code).toContainText("manual draft");
    await page.screenshot({ path: "test-results/files-desktop.png" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Close src/main.ts file" }).click();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent edits produce a conflict and Vim saves use the file service", async ({ page }) => {
  const root = await project(page);
  try {
    await openSource(page);
    const code = page.getByRole("textbox", { name: "Code editor: src/main.ts" });
    await code.fill("my draft");
    writeFileSync(join(root, "src/main.ts"), "agent changed this");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("This file changed on the machine. Your version is kept."),
    ).toBeVisible();
    expect(readFileSync(join(root, "src/main.ts"), "utf8")).toBe("agent changed this");
    await expect(code).toContainText("my draft");
    await page.getByRole("button", { name: "Compare with disk" }).click();
    await expect(page.getByText("agent changed this", { exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Keep my draft", exact: true }).click();
    await page.getByRole("button", { name: "Vim", exact: true }).click();
    await code.click();
    await page.keyboard.press("Escape");
    await page.keyboard.type(":w");
    await page.keyboard.press("Enter");
    await expect.poll(() => readFileSync(join(root, "src/main.ts"), "utf8")).toBe("my draft");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("file drawer and editor fit a narrow viewport", async ({ page }) => {
  const root = await project(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await openSource(page);
    await expect(page.getByRole("complementary", { name: "Project files" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Code editor: src/main.ts" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: "test-results/files-mobile.png" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent file links open Markdown and code tabs without leaving the workspace", async ({
  page,
}) => {
  const root = await project(page);
  try {
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toBeEnabled();
    await page.getByLabel("Message Codex").fill("file-links");
    await page.getByLabel("Message Codex").press("Enter");
    await page.getByRole("link", { name: "the README", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Project files", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit source", exact: true }).click();
    const markdown = page.getByRole("textbox", { name: "Code editor: README.md" });
    await markdown.fill("# Edited readme\n");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => readFileSync(join(root, "README.md"), "utf8"))
      .toBe("# Edited readme\n");
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await page.getByRole("link", { name: "the code", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Code editor: src/main.ts" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
