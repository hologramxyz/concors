import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

// Real files exercise the same filename matching used by the tree and editor tabs.
test("file types have distinct colored icons in the tree and open tabs in both themes", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "concors-file-icons-"));
  const names = [
    "app.js",
    "main.ts",
    "App.tsx",
    "config.yaml",
    "README.md",
    "package.json",
    "Dockerfile",
    ".gitignore",
    ".env.staging",
    "data.json",
    "script.py",
    "styles.css",
    "archive.zip",
    "unknown.custom",
  ];
  try {
    await mkdir(join(root, "src"));
    for (const name of names) await writeFile(join(root, name), "# File icon fixture\n");
    await symlink(join(root, "main.ts"), join(root, "linked.ts"));
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "File icons", root);
    await page.getByRole("button", { name: "Toggle project files", exact: true }).click();
    const tree = page.getByRole("complementary", { name: "Project files", exact: true });
    await tree.getByRole("button", { name: "Show hidden files", exact: true }).click();
    const icons = names.map((name) =>
      tree.getByRole("button", { name, exact: true }).locator("[data-file-icon]"),
    );
    for (const icon of icons) {
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute("aria-hidden", "true");
      await expect(icon).toHaveCSS("width", "20px");
    }
    const shapes = await Promise.all(icons.map((icon) => icon.innerHTML()));
    expect(new Set(shapes).size).toBe(names.length);
    const colors = await Promise.all(
      icons.map((icon) =>
        icon
          .locator("[fill^='#'], [stroke^='#']")
          .first()
          .evaluate((el) => el.getAttribute("fill") ?? el.getAttribute("stroke")),
      ),
    );
    expect(new Set(colors).size).toBeGreaterThan(5);
    // Symlinks and folders retain their separate meaning and behavior.
    await expect(tree.getByRole("button", { name: "linked.ts", exact: true })).toBeDisabled();
    await expect(
      tree.getByRole("button", { name: "linked.ts", exact: true }).locator("[data-file-icon]"),
    ).toHaveCount(0);
    await tree.getByRole("button", { name: "src", exact: true }).click();
    await expect(tree.getByRole("button", { name: "src", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    for (const mode of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: mode });
      await expect(
        tree.getByRole("button", { name: "app.js", exact: true }).locator("[data-file-icon]"),
      ).toHaveCSS("filter", mode === "dark" ? "brightness(1.1)" : "brightness(0.75)");
      await page.screenshot({ path: test.info().outputPath(`file-icons-${mode}.png`) });
    }
    await tree.getByRole("button", { name: "main.ts", exact: true }).click();
    const tabIcon = page
      .locator('button[aria-pressed="true"]')
      .filter({ hasText: "main.ts" })
      .locator("[data-file-icon]");
    await expect(tabIcon).toBeVisible();
    expect(await tabIcon.innerHTML()).toBe(shapes[1]);
    await expect(tabIcon).toHaveCSS("width", "18px");
    await expect(
      page.getByRole("textbox", { name: "Code editor: main.ts", exact: true }),
    ).toBeVisible();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
