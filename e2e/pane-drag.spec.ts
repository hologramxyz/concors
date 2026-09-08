import { test, expect } from "@playwright/test";
import { signedIn } from "./signed-in.ts";

test("dragging swaps panes and creates a vertical split without replacing sessions", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");
    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.getByLabel("Project name", { exact: true }).fill("Pane dragging");
    await page.getByLabel("Folder on this machine").fill("/tmp");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".xterm")).toBeVisible();
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally" }).click();
    await expect(page.locator(".xterm")).toHaveCount(2);
    const panes = page.locator("[data-pane-id]");
    const sourceId = await panes.first().getAttribute("data-pane-id");
    const targetId = await panes.last().getAttribute("data-pane-id");
    if (!sourceId || !targetId) throw new Error("Pane IDs missing");
    const source = page.locator(`[data-pane-id="${sourceId}"]`);
    const target = page.locator(`[data-pane-id="${targetId}"]`);
    await source.locator("textarea").focus();
    await page.keyboard.type("echo PANE_SESSION_PRESERVED");
    await page.keyboard.press("Enter");
    await expect(source.getByLabel("Terminal output")).toContainText("PANE_SESSION_PRESERVED");
    await second.goto("/");
    await expect(second.locator(".xterm")).toHaveCount(2);
    await source.locator("header").dragTo(target);
    await expect(panes.first()).toHaveAttribute("data-pane-id", targetId);
    await expect(second.locator("[data-pane-id]").first()).toHaveAttribute(
      "data-pane-id",
      targetId,
    );
    const box = await target.boundingBox();
    if (!box) throw new Error("Drop target is not visible");
    await source
      .locator("header")
      .dragTo(target, { targetPosition: { x: box.width / 2, y: box.height - 8 } });
    await expect(page.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
    await expect(second.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
    await expect(source.getByLabel("Terminal output")).toContainText("PANE_SESSION_PRESERVED");
    await second.reload();
    await expect(second.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
    await expect(
      second.locator(`[data-pane-id="${sourceId}"]`).getByLabel("Terminal output"),
    ).toContainText("PANE_SESSION_PRESERVED");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
