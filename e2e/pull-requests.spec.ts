import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0047ab"/></svg>';
const repository = (directory: string, remote: string) => {
  execFileSync("git", ["init", "--quiet", directory]);
  execFileSync("git", ["-C", directory, "remote", "add", "origin", remote]);
};

test("a folder of repositories shows a child favicon, its pull request count and breakdown", async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "concors-pull-requests-"));
  const hologram = join(root, "hologram");
  const opened: string[] = [];
  try {
    // app sorts first and has the favicon; the grandchild is not one of hologram's repositories.
    repository(join(hologram, "app"), "git@github.com:hologram/app.git");
    repository(join(hologram, "site"), "https://github.com/hologram/site.git");
    repository(join(hologram, "archive", "old"), "https://github.com/hologram/old.git");
    await mkdir(join(hologram, "app", "public"), { recursive: true });
    await writeFile(join(hologram, "app", "public", "favicon.svg"), svg);
    await signedIn(page);
    await page.addInitScript(() => {
      window.open = (url) => {
        (window as unknown as { opened: string[] }).opened ??= [];
        (window as unknown as { opened: string[] }).opened.push(String(url));
        return null;
      };
    });
    await page.goto("/");
    await seedProject(page, "hologram", hologram);
    await seedProject(page, "repos", root);

    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const row = sidebar.getByRole("button", { name: "hologram", exact: true });
    await expect(row.locator('[data-project-icon="favicon"] img')).toHaveAttribute(
      "src",
      /^data:image\/svg\+xml;base64,/,
    );
    // One level only: the folder holding hologram keeps the folder icon and shows no count.
    await expect(
      sidebar
        .getByRole("button", { name: "repos", exact: true })
        .locator('[data-project-icon="folder"]'),
    ).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /open pull requests? in repos/ })).toHaveCount(
      0,
    );

    const count = sidebar.getByRole("button", { name: "3 open pull requests in hologram" });
    await expect(count).toHaveText("3");
    const box = await count.boundingBox();
    const rowBox = await row.locator("xpath=..").boundingBox();
    // The count ends the row, after its actions.
    expect(box && rowBox && rowBox.x + rowBox.width - (box.x + box.width)).toBeLessThan(4);
    await expect(sidebar.getByRole("button", { name: "Pull requests", exact: true })).toContainText(
      "3",
    );

    await count.hover();
    const breakdown = page.getByRole("list", {
      name: "Pull requests by repository in hologram",
    });
    await expect(breakdown.getByRole("listitem")).toHaveText(["app2", "site1"]);
    await page.screenshot({ path: test.info().outputPath("workspace-pull-requests-hover.png") });
    await breakdown.getByRole("link", { name: /^site/ }).click();
    opened.push(...(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)));
    expect(opened).toEqual(["https://github.com/hologram/site/pulls"]);

    await count.hover();
    await page.getByRole("button", { name: "View all", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pull requests", level: 2 })).toBeVisible();
    await expect(breakdown).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^hologram/, pressed: true })).toBeVisible();
    const app = page.getByRole("article", { name: "hologram/app" });
    await expect(app).toContainText("Show pull requests in workspaces");
    await expect(app).toContainText("#42 · e2e-user · change-42 · 2h ago");
    await expect(app).toContainText("Approved");
    await expect(app.getByRole("img", { name: "Checks passing" })).toBeVisible();
    await expect(app.getByRole("img", { name: "Draft" })).toBeVisible();
    await expect(page.getByRole("article", { name: "hologram/site" })).toContainText(
      "Changes requested",
    );
    await page.screenshot({ path: test.info().outputPath("workspace-pull-requests-page.png") });

    await page.getByRole("button", { name: "Opened by you" }).click();
    await expect(app.locator("[data-pull-request]")).toHaveCount(1);
    await expect(page.getByRole("article", { name: "hologram/site" })).toContainText(
      "None opened by you",
    );
    await page.getByRole("button", { name: /^All workspaces/ }).click();
    await expect(page.getByRole("button", { name: /^All workspaces/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
