import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

test("dragging moves panes across the workspace without replacing sessions", async ({
  page,
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-drag-"));
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");
    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.getByLabel("Project name", { exact: true }).fill("Pane dragging");
    await page.getByLabel("Folder on this machine").fill(directory);
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
    await source.locator("textarea").focus();
    await page.keyboard.type("echo PANE_SESSION_PRESERVED");
    await page.keyboard.press("Enter");
    await expect(source.getByLabel("Terminal output")).toContainText("PANE_SESSION_PRESERVED");
    await second.goto("/");
    await expect(second.locator(".xterm")).toHaveCount(2);
    const workspace = page.getByTestId("pane-workspace");
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await source.locator("header").dispatchEvent("dragstart", { dataTransfer: transfer });
    const overlay = page.getByTestId("pane-drop-targets");
    await expect(overlay.locator("[data-drop-zone]")).toHaveCount(4);
    await expect(overlay).toHaveText("");
    const overlayBounds = await overlay.boundingBox();
    const workspaceBounds = await workspace.boundingBox();
    expect(overlayBounds?.width).toBe(workspaceBounds?.width);
    expect(overlayBounds?.height).toBe(workspaceBounds?.height);
    await source.locator("header").dispatchEvent("dragend");
    await transfer.dispose();
    const bounds = await workspace.boundingBox();
    if (!bounds) throw new Error("Workspace missing");
    await source
      .locator("header")
      .dragTo(workspace, { targetPosition: { x: bounds.width - 8, y: bounds.height / 2 } });
    await expect(panes.first()).toHaveAttribute("data-pane-id", targetId);
    await expect(second.locator("[data-pane-id]").first()).toHaveAttribute(
      "data-pane-id",
      targetId,
    );
    const box = await workspace.boundingBox();
    if (!box) throw new Error("Drop target is not visible");
    await source
      .locator("header")
      .dragTo(workspace, { targetPosition: { x: box.width / 2, y: box.height - 8 } });
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
    await rm(directory, { recursive: true, force: true });
  }
});
