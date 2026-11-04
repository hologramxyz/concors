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
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    const effort = page.getByRole("button", { name: "Thinking effort", exact: true });
    const effortLabel = effort.locator("span");
    const modelLabel = page
      .getByRole("button", { name: "Agent and model", exact: true })
      .locator("span");
    const toolbar = page.locator(".agent-composer-toolbar");
    /** Every visible control's vertical centre, and whether any control spills past the row. */
    const layout = () =>
      toolbar.evaluate((row) => {
        const bounds = row.getBoundingClientRect();
        // A control that dropped off the end of a narrow row sits below it, clipped.
        const controls = [...row.querySelectorAll("button")]
          .map((button) => button.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0 && box.top < bounds.bottom);
        return {
          rows: new Set(controls.map((box) => Math.round(box.top + box.height / 2))).size,
          overflows: controls.some((box) => box.right > bounds.right + 0.5),
        };
      });

    await expect(effortLabel).toBeVisible();
    expect(await layout()).toEqual({ rows: 1, overflows: false });
    await page.screenshot({ path: test.info().outputPath("composer-wide.png") });

    // Every control uses the same app tooltip. A menu hides its tooltip, and choosing an
    // option does not bring it back as focus returns to the control.
    const tooltip = page.getByRole("tooltip");
    await page.getByRole("button", { name: "Plan mode", exact: true }).hover();
    await expect(tooltip).toHaveText(/^Plan mode: explore and plan/);
    // A tooltip closes on the pointer's next move after it leaves, as a real mouse makes.
    await page.mouse.move(0, 0, { steps: 5 });
    await expect(tooltip).toHaveCount(0);
    const speed = page.getByRole("button", { name: "Speed", exact: true });
    await speed.hover();
    await expect(tooltip).toHaveText(/^Speed: /);
    await speed.click();
    await expect(tooltip).toHaveCount(0);
    await page.getByRole("option").last().click();
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(tooltip).toHaveCount(0);
    await effort.hover();
    await expect(tooltip).toHaveText(/^Thinking effort: /);
    await expect(effort).not.toHaveAttribute("title");
    await page.mouse.move(0, 0, { steps: 5 });
    await expect(tooltip).toHaveCount(0);

    // Labels give way to icons rather than pushing the send button onto a second row.
    for (const width of [900, 760, 640]) {
      await page.setViewportSize({ width, height: 850 });
      await expect.poll(layout).toEqual({ rows: 1, overflows: false });
    }
    await expect(effortLabel).toBeHidden();
    await effort.hover();
    await expect(tooltip).toHaveText(/^Thinking effort: /);
    await page.mouse.move(0, 0, { steps: 5 });
    await expect(tooltip).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("composer-narrow.png") });

    // A pane of about 470px, like three side by side: the model keeps its name, truncated if
    // need be, after the other pickers have become icons.
    await page.setViewportSize({ width: 760, height: 850 });
    await expect.poll(layout).toEqual({ rows: 1, overflows: false });
    await expect(effortLabel).toBeHidden();
    await expect(modelLabel).toBeVisible();
    expect(
      await modelLabel.evaluate((label) => label.getBoundingClientRect().width),
    ).toBeGreaterThan(40);
    await page.screenshot({ path: test.info().outputPath("composer-pane.png") });

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
    await expect(modelLabel).toBeHidden();
    await page.screenshot({ path: test.info().outputPath("composer-phone.png") });

    await page.setViewportSize({ width: 1360, height: 850 });
    await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expect(effortLabel).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the send button stays inside the composer in a pane of any width", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-composer-narrow-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Narrow", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally" }).click();
    const handle = page.getByRole("separator", { name: "Resize split" });
    const pane = page.locator("[data-pane-id]").filter({ visible: true }).first();
    const form = pane.locator(".agent-composer-form");
    const measure = () =>
      form.evaluate((box) => {
        const outer = box.getBoundingClientRect();
        const send = box.querySelector('button[type="submit"]')?.getBoundingClientRect();
        const row = box.querySelector(".agent-composer-toolbar")?.getBoundingClientRect();
        const seen = [...box.querySelectorAll(".agent-composer-toolbar button")]
          .filter((button) => {
            const area = button.getBoundingClientRect();
            return area.width > 0 && row !== undefined && area.top < row.bottom;
          })
          .map((button) => button.getBoundingClientRect());
        return {
          form: outer.width,
          sendInside:
            !!send &&
            send.width > 0 &&
            send.left >= outer.left &&
            send.right <= outer.right &&
            send.bottom <= outer.bottom,
          rows: new Set(seen.map((area) => Math.round(area.top + area.height / 2))).size,
          seen: seen.length,
        };
      });
    const widths = new Set<number>();
    await handle.focus();
    // Down to a tenth of a wide workspace, then the same in a smaller window.
    for (let step = 0; step < 9; step++) {
      const measured = await measure();
      widths.add(Math.round(measured.form));
      expect(measured, `form ${measured.form}px wide`).toMatchObject({ sendInside: true, rows: 1 });
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(50);
    }
    const narrowest = await measure();
    // The workspace stops shrinking at 320px, which makes a tenth of it the narrowest pane.
    let previous = narrowest.form;
    for (const width of [800, 600, 480]) {
      await page.setViewportSize({ width, height: 850 });
      await expect.poll(async () => (await measure()).form).toBeLessThan(previous);
      const measured = await measure();
      previous = measured.form;
      expect(measured, `form ${measured.form}px wide`).toMatchObject({ sendInside: true, rows: 1 });
    }
    // Controls went as the room did, but only once there was no room for them.
    expect(Math.min(...widths)).toBeLessThan(200);
    expect(narrowest.seen).toBeLessThan(5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
