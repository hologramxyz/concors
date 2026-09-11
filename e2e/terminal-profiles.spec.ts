import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("terminal profiles sync, launch literal arguments, and switch within the same pane", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-profile-ui-"));
  const script = join(directory, "profile.cjs");
  await writeFile(
    script,
    'console.log("PROFILE:"+JSON.stringify(process.argv.slice(2))); process.stdin.resume();',
  );
  const other = await browser.newContext();
  const second = await other.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  second.on("pageerror", (error) => errors.push(error.message));
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");
    await seedProject(page, "Profiles", directory);
    await second.goto(page.url());
    await page.getByRole("button", { name: "Pane actions" }).click();
    for (const name of ["Terminal", "Agent", "Codex", "Claude Code", "OpenCode"]) {
      await expect(
        page.getByRole("menuitemradio", { name, exact: true }).locator("svg").last(),
      ).toBeVisible();
    }
    await page.getByRole("menuitem", { name: "Edit pane profiles" }).click();
    await expect(page.getByRole("heading", { name: "Terminals", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit Codex profile" }).click();
    await expect(page.getByLabel("Command", { exact: true })).toHaveValue("codex");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Add terminal profile", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Dev task");
    await page.getByLabel("Command", { exact: true }).fill(process.execPath);
    await page
      .getByLabel("Arguments", { exact: true })
      .fill([script, "two words", "literal & $()"].join("\n"));
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({ path: "test-results/terminal-profiles-settings.png" });
    await second.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(second.getByRole("menuitem", { name: "Dev task", exact: true })).toBeVisible();
    await second.getByRole("menuitem", { name: "Dev task", exact: true }).click();
    await expect(second.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      'PROFILE:["two words","literal & $()"]',
    );
    await page.getByRole("button", { name: "Edit Dev task profile" }).click();
    await page.getByLabel("Arguments", { exact: true }).fill([script, "updated"].join("\n"));
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(second.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      'PROFILE:["two words","literal & $()"]',
    );
    await second.reload();
    await second.getByRole("button", { name: "Pane actions" }).click();
    await second.getByRole("menuitemradio", { name: "Terminal", exact: true }).click();
    await expect(
      second
        .getByRole("region", { name: "Terminal pane", exact: true })
        .getByLabel("Terminal output"),
    ).toHaveAttribute("aria-busy", "false");
    await second.getByRole("button", { name: "Pane actions" }).click();
    await second.getByRole("menuitemradio", { name: "Dev task", exact: true }).click();
    await expect(
      second
        .getByRole("region", { name: "Dev task pane", exact: true })
        .getByLabel("Terminal output"),
    ).toContainText('PROFILE:["updated"]');
    await second.getByRole("button", { name: "Pane actions" }).click();
    await second.getByRole("menuitem", { name: "Split horizontally", exact: true }).click();
    await expect(second.getByRole("region", { name: "Dev task pane", exact: true })).toHaveCount(2);
    for (const pane of await second
      .getByRole("region", { name: "Dev task pane", exact: true })
      .all())
      await expect(pane.getByLabel("Terminal output")).toContainText('PROFILE:["updated"]');
    await page.getByRole("button", { name: "Edit Dev task profile" }).click();
    await page.getByRole("button", { name: "Delete profile", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit Dev task profile" })).toHaveCount(0);
    await second.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(second.getByRole("menuitem", { name: "Dev task", exact: true })).toHaveCount(0);
    await second.getByRole("menuitem", { name: "Edit pane profiles" }).click();
    await expect(second.getByRole("heading", { name: "Terminals", exact: true })).toBeVisible();
    await second.getByRole("button", { name: "Add terminal profile", exact: true }).click();
    await expect(second.getByRole("dialog", { name: "Add terminal profile" })).toBeVisible();
    await expect(second.getByLabel("Name", { exact: true })).toBeFocused();
    await second.screenshot({ path: "test-results/terminal-profile-editor.png" });
    await second.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(second.getByRole("heading", { name: "Terminals", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await other.close();
    await rm(directory, { recursive: true, force: true });
  }
});
