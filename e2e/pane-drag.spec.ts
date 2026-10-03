import { seedProject } from "./support/projects.ts";
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
    await seedProject(page, "Pane dragging", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    // Tab 1's terminal is visible too until the new tab arrives, and so is its "Pane actions".
    await expect(
      page
        .getByLabel("Project tabs", { exact: true })
        .getByRole("button", { name: "Tab 2", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".xterm").filter({ visible: true })).toBeVisible();
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally" }).click();
    await expect(page.locator(".xterm").filter({ visible: true })).toHaveCount(2);
    const panes = page.locator("[data-pane-id]").filter({ visible: true });
    const sourceId = await panes.first().getAttribute("data-pane-id");
    const targetId = await panes.last().getAttribute("data-pane-id");
    if (!sourceId || !targetId) throw new Error("Pane IDs missing");
    const source = page.locator(`[data-pane-id="${sourceId}"]`);
    await source.locator("textarea").focus();
    await page.keyboard.type("echo PANE_SESSION_PRESERVED");
    await page.keyboard.press("Enter");
    await expect(source.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "PANE_SESSION_PRESERVED",
    );
    await second.goto("/");
    await expect(second.locator(".xterm").filter({ visible: true })).toHaveCount(2);
    const workspace = page.getByTestId("pane-workspace").filter({ visible: true });
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
    await expect(
      second.locator("[data-pane-id]").filter({ visible: true }).first(),
    ).toHaveAttribute("data-pane-id", targetId);
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
    await expect(source.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "PANE_SESSION_PRESERVED",
    );
    await second.reload();
    await expect(second.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
    await expect(
      second
        .locator(`[data-pane-id="${sourceId}"]`)
        .getByLabel("Terminal output")
        .filter({ visible: true }),
    ).toContainText("PANE_SESSION_PRESERVED");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a pane menu opened while a new tab launches closes when that tab takes over", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-menu-launch-"));
  // The new tab appears once the daemon answers. Hold that answer so the shown tab's pane menu
  // can be opened in the meantime, as a quick hand (or test) does.
  let holding = false;
  const held: string[] = [];
  let deliver: ((raw: string) => void) | undefined;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    deliver = (raw) => socket.send(raw);
    socket.onMessage((raw) => server.send(raw));
    server.onMessage((raw) => {
      const type = (JSON.parse(String(raw)) as { type?: string }).type;
      if (holding && (type === "workspace.snapshot" || type === "workspace.result"))
        held.push(String(raw));
      else socket.send(raw);
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Menu during launch", directory);
    holding = true;
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect.poll(() => held.some((raw) => raw.includes('"workspace.result"'))).toBe(true);
    await page.getByRole("button", { name: "Pane actions" }).click();
    const split = page.getByRole("menuitem", { name: "Split horizontally" });
    await expect(split).toBeDisabled();
    holding = false;
    for (const raw of held.splice(0)) deliver?.(raw);
    // CSS, not roles: an open menu hides the rest of the page from the accessibility tree.
    await expect(
      page.locator('[aria-label="Project tabs"] [data-tab-id] > button:first-child', {
        hasText: "Tab 2",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    // The menu belonged to a pane that is now hidden; left open it hung in the window's corner
    // with every item disabled.
    await expect(page.getByRole("menu", { name: "Pane actions" })).toHaveCount(0);
    await page.getByRole("button", { name: "Pane actions" }).click();
    await split.click();
    await expect(page.locator(".xterm").filter({ visible: true })).toHaveCount(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
