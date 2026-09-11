import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("tabs are numbered per workspace and keep custom names across pane changes and reloads", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-names-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Numbered tabs", directory);
    const tabs = page.getByLabel("Project tabs", { exact: true });
    const labels = () => tabs.locator("[data-tab-id] > button:first-child").allTextContents();
    await expect.poll(labels).toEqual(["Tab 1"]);
    for (const [profile, expected] of [
      ["Agent", "Tab 2"],
      ["Codex", "Tab 3"],
    ]) {
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await page.getByRole("menuitem", { name: profile, exact: true }).click();
      await expect(tabs.getByRole("button", { name: expected, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    await tabs.getByRole("button", { name: "Tab 1", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename tab", exact: true }).click();
    await page.getByLabel("Tab name", { exact: true }).fill("Build and review");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await tabs.getByRole("button", { name: "Build and review", exact: true }).click();
    await page.getByRole("button", { name: "Pane actions", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Agent", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await page.getByRole("button", { name: "Pane actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Split horizontally", exact: true }).click();
    await expect(page.getByRole("region", { name: "Agent pane", exact: true })).toHaveCount(2);
    await expect.poll(labels).toEqual(["Build and review", "Tab 2", "Tab 3"]);
    await tabs.getByRole("button", { name: "Close Tab 2 tab", exact: true }).click();
    await tabs
      .getByRole("button", { name: "Tab 3", exact: true })
      .dragTo(tabs.getByRole("button", { name: "Build and review", exact: true }));
    await expect.poll(labels).toEqual(["Tab 3", "Build and review"]);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect.poll(labels).toEqual(["Tab 3", "Build and review", "Tab 4"]);
    await page.reload();
    await expect.poll(labels).toEqual(["Tab 3", "Build and review", "Tab 4"]);
    await mkdir(join(directory, "other"));
    await seedProject(page, "Another numbered workspace", join(directory, "other"));
    await expect.poll(labels).toEqual(["Tab 1"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
