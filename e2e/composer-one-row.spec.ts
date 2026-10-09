import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("the composer keeps its controls and send button on one row at every width", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-composer-row-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "One row", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    const effort = page.getByRole("button", { name: "Thinking effort", exact: true });
    const effortLabel = effort.locator("span");
    const toolbar = page.locator(".agent-composer-toolbar");
    /** Every visible control's vertical centre, and whether any control spills past the row. */
    const layout = () =>
      toolbar.evaluate((row) => {
        const bounds = row.getBoundingClientRect();
        const controls = [...row.querySelectorAll("button")]
          .map((button) => button.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0);
        return {
          rows: new Set(controls.map((box) => Math.round(box.top + box.height / 2))).size,
          overflows: controls.some((box) => box.right > bounds.right + 0.5),
        };
      });

    await expect(effortLabel).toBeVisible();
    expect(await layout()).toEqual({ rows: 1, overflows: false });
    await page.screenshot({ path: test.info().outputPath("composer-wide.png") });

    // Labels give way to icons rather than pushing the send button onto a second row.
    for (const width of [900, 760, 640]) {
      await page.setViewportSize({ width, height: 850 });
      await expect.poll(layout).toEqual({ rows: 1, overflows: false });
    }
    await expect(effortLabel).toBeHidden();
    await expect(effort).toHaveAttribute("title", /^Thinking effort: /);
    await page.screenshot({ path: test.info().outputPath("composer-narrow.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    // Sidebar width animates after the click; wait for the composer to fit the viewport.
    await expect
      .poll(async () => {
        const box = await toolbar.boundingBox();
        return box ? box.x + box.width : Infinity;
      })
      .toBeLessThanOrEqual(390);
    await expect.poll(layout).toEqual({ rows: 1, overflows: false });
    await page.screenshot({ path: test.info().outputPath("composer-phone.png") });

    await page.setViewportSize({ width: 1360, height: 850 });
    await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expect(effortLabel).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
