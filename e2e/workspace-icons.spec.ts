import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("folders, repo initials and local favicons match in expanded and collapsed sidebars", async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "concors-workspace-icons-"));
  const externalImages: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("opengraph.githubassets.com")) externalImages.push(request.url());
  });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0047ab"/><path fill="white" d="M9 7h5v13h10v5H9z"/></svg>';
  try {
    await signedIn(page);
    await page.goto("/");
    for (const name of ["Notes", "Atlas", "Lumen", "Broken icon"]) {
      const directory = join(root, name);
      await mkdir(join(directory, "public"), { recursive: true });
      if (name !== "Notes") execFileSync("git", ["-C", directory, "init", "--quiet"]);
      if (name === "Notes" || name === "Lumen")
        await writeFile(join(directory, "public/favicon.svg"), svg);
      if (name === "Broken icon")
        await writeFile(
          join(directory, "favicon.png"),
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
        );
      await seedProject(page, name, directory);
    }
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    for (const compact of [false, true, false]) {
      if (compact)
        await sidebar.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      else if (await sidebar.getByRole("button", { name: "Expand sidebar", exact: true }).count())
        await sidebar.getByRole("button", { name: "Expand sidebar", exact: true }).click();
      for (const [name, kind, initial] of [
        ["Notes", "folder", ""],
        ["Atlas", "initial", "A"],
        ["Lumen", "favicon", ""],
        ["Broken icon", "initial", "B"],
      ]) {
        const button = sidebar.getByRole("button", { name, exact: true });
        const icon = button.locator(`[data-project-icon="${kind}"]`);
        await expect(icon).toBeVisible();
        await expect(icon).toHaveCSS("width", "20px");
        if (initial) await expect(icon).toHaveText(initial);
        if (kind === "favicon") {
          await expect(icon.locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
          expect(
            await icon
              .locator("img")
              .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
          ).toBe(true);
        }
        await page.keyboard.press("Escape");
        await button.hover();
        await expect(page.getByRole("tooltip")).toContainText(join(root, name));
        await button.click();
        await expect(button).toHaveAttribute("aria-current", "page");
      }
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: test
          .info()
          .outputPath(compact ? "project-icons-rail.png" : "project-icons-expanded.png"),
      });
    }
    await page.reload();
    await expect(
      sidebar
        .getByRole("button", { name: "Lumen", exact: true })
        .locator('[data-project-icon="favicon"]'),
    ).toBeVisible();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: test.info().outputPath("project-icons-dark.png") });
    expect(externalImages).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
