import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("live palette changes recolor editor and cached previews without losing drafts or undo", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "concors-code-themes-"));
  const source = "const answer = 42;\n";
  await writeFile(join(root, "example.ts"), source);
  await writeFile(join(root, "README.md"), `# Preview\n\n\`\`\`ts\n${source}\`\`\`\n`);
  const settings = await context.newPage();
  try {
    await page.emulateMedia({ colorScheme: "light" });
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Code theme test", root);
    await page.getByRole("button", { name: "Toggle project files" }).click();
    const files = page.getByRole("complementary", { name: "Project files" });
    await files.getByRole("button", { name: "example.ts", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Code editor: example.ts" });
    await expect(editor).toContainText(source.trim());
    await editor.press("Control+End");
    await page.keyboard.type("// unsaved theme draft");
    await editor.press("Control+Home");
    await editor.press("ArrowRight");
    const originalEditor = await editor.elementHandle();
    if (!originalEditor) throw new Error("Code editor is missing");
    const keyword = editor
      .locator("span")
      .filter({ hasText: /^const$/ })
      .first();
    await expect(keyword).toHaveCSS("color", "rgb(207, 34, 46)");

    // Select themes in another app window so the editor stays mounted and focused.
    await signedIn(settings);
    await settings.goto("/");
    await expect(
      settings.getByRole("heading", { name: "Code theme test", exact: true }),
    ).toBeVisible();
    await settings.keyboard.press("Control+Shift+Comma");
    await settings.getByRole("button", { name: "Appearance", exact: true }).click();
    const colors: string[] = [];
    for (const palette of ["Cobalt", "Dusk", "Concors"]) {
      await settings.getByRole("radio", { name: palette, exact: true }).locator("..").click();
      await expect(page.locator("html")).toHaveAttribute("data-color-theme", palette.toLowerCase());
      const expected = await page.locator("html").evaluate((node) => {
        const hex = getComputedStyle(node).getPropertyValue("--syntax-keyword").trim();
        return `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
      });
      await expect(keyword).toHaveCSS("color", expected);
      colors.push(expected);
      expect(await originalEditor.evaluate((node) => node.isConnected)).toBe(true);
      await expect(editor).toContainText("// unsaved theme draft");
      expect(await editor.evaluate(() => window.getSelection()?.anchorOffset)).toBe(1);
    }
    expect(new Set(colors).size).toBe(3);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(keyword).toHaveCSS("color", "rgb(255, 123, 114)");
    await editor.press("Control+z");
    await expect(editor).not.toContainText("unsaved theme draft");
    expect(await readFile(join(root, "example.ts"), "utf8")).toBe(source);

    await files.getByRole("button", { name: "README.md", exact: true }).click();
    const previewKeyword = page.locator('.syntax-token[data-syntax="keyword"]').first();
    await expect(previewKeyword).toHaveCSS("color", "rgb(255, 123, 114)");
    const originalToken = await previewKeyword.elementHandle();
    if (!originalToken) throw new Error("Preview keyword is missing");
    await settings.getByRole("radio", { name: "Cobalt", exact: true }).locator("..").click();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "cobalt");
    await expect(previewKeyword).not.toHaveCSS("color", "rgb(255, 123, 114)");
    expect(await originalToken.evaluate((node) => node.isConnected)).toBe(true);
    const previewColor = await previewKeyword.evaluate((node) => getComputedStyle(node).color);
    await files.getByRole("button", { name: "example.ts", exact: true }).click();
    await expect(keyword).toHaveCSS("color", previewColor);
    await page.screenshot({ path: "test-results/code-themes-cobalt.png" });
  } finally {
    await settings.close();
    await rm(root, { recursive: true, force: true });
  }
});
