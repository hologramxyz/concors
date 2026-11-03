import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { tab } from "./support/tabs.ts";

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
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    // The first tab's terminal is visible too until the new tab arrives, and so is its "Pane
    // actions".
    await expect(tab(page, 1)).toHaveAttribute("aria-pressed", "true");
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
    const header = source.locator("header");
    await expect(header).not.toHaveAttribute("title");
    await expect(header).toHaveCSS("cursor", "grab");
    const preview = page.getByTestId("pane-drop-preview");
    const workspaceBox = await workspace.boundingBox();
    const headerBox = await header.boundingBox();
    if (!workspaceBox || !headerBox) throw new Error("Workspace missing");
    await page.mouse.move(headerBox.x + 60, headerBox.y + headerBox.height / 2);
    await page.mouse.down();
    // Inside the threshold this is still a click, so nothing is dragged yet.
    await page.mouse.move(headerBox.x + 61, headerBox.y + headerBox.height / 2);
    await expect(page.locator("html")).not.toHaveAttribute("data-pane-dragging");
    await page.mouse.move(workspaceBox.x + workspaceBox.width - 8, workspaceBox.y + 200, {
      steps: 4,
    });
    await expect(page.locator("html")).toHaveAttribute("data-pane-dragging");
    await expect(page.locator("body")).toHaveCSS("cursor", "grabbing");
    await expect(source).toHaveCSS("opacity", "0.6");
    // One outline only, and it covers exactly where the pane lands: the right half.
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute("data-placement", "right");
    const area = await preview.boundingBox();
    expect(Math.abs((area?.width ?? 0) - (workspaceBox.width / 2 - 6.5))).toBeLessThanOrEqual(1);
    expect(Math.abs((area?.height ?? 0) - (workspaceBox.height - 6.5))).toBeLessThanOrEqual(3);
    // The tint stays faint and in the link colour, not the foreground grey it replaced.
    const colors = await preview.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--link)";
      element.append(probe);
      const link = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(element);
      return { link, border: style.borderTopColor, fill: style.backgroundColor };
    });
    expect(colors.border).toBe(colors.link);
    expect(colors.fill).toMatch(/\/ 0\.1\)$|, 0\.1\)$/);
    // Off the workspace there is nowhere to land.
    await page.mouse.move(workspaceBox.x - 20, workspaceBox.y + 200);
    await expect(preview).toHaveCount(0);
    await page.mouse.move(workspaceBox.x + 8, workspaceBox.y + 200);
    await expect(preview).toHaveAttribute("data-placement", "left");
    // Escape cancels: the release that follows moves nothing.
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(source).toHaveCSS("opacity", "1");
    await page.mouse.up();
    await expect(page.locator("html")).not.toHaveAttribute("data-pane-dragging");
    await expect(panes.first()).toHaveAttribute("data-pane-id", sourceId);
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

test("a lone pane cannot be dragged, and a split one still renames by double-click", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-lone-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Lone pane", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect(tab(page, 1)).toHaveAttribute("aria-pressed", "true");
    const panes = page.locator("[data-pane-id]").filter({ visible: true });
    await expect(panes).toHaveCount(1);
    const header = panes.first().locator("header");
    await expect(header).toHaveCSS("cursor", "auto");
    const box = await header.boundingBox();
    if (!box) throw new Error("Header missing");
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 300, { steps: 4 });
    await expect(page.locator("html")).not.toHaveAttribute("data-pane-dragging");
    await expect(page.getByTestId("pane-drop-preview")).toHaveCount(0);
    await page.mouse.up();

    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally" }).click();
    await expect(panes).toHaveCount(2);
    const name = panes.first().locator("header span.truncate");
    await name.dblclick();
    const input = panes.first().getByRole("textbox", { name: "Pane name" });
    await expect(input).toBeVisible();
    // Renaming, the header is a text field's surroundings and not a handle.
    await expect(panes.first().locator("header")).toHaveCSS("cursor", "auto");
    await page.keyboard.press("Escape");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("with three panes the outline shows the half of the workspace the pane lands on", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-three-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Three panes", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect(tab(page, 1)).toHaveAttribute("aria-pressed", "true");
    const panes = page.locator("[data-pane-id]").filter({ visible: true });
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally" }).click();
    await expect(panes).toHaveCount(2);
    await panes.last().getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split vertically" }).click();
    await expect(panes).toHaveCount(3);
    const workspace = page.getByTestId("pane-workspace").filter({ visible: true });
    const source = panes.first();
    const sourceId = await source.getAttribute("data-pane-id");
    const headerBox = await source.locator("header").boundingBox();
    const box = await workspace.boundingBox();
    if (!headerBox || !box) throw new Error("Workspace missing");
    await page.mouse.move(headerBox.x + 60, headerBox.y + headerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8, { steps: 4 });
    const preview = page.getByTestId("pane-drop-preview");
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute("data-placement", "bottom");
    const area = await preview.boundingBox();
    expect(Math.abs((area?.height ?? 0) - (box.height / 2 - 6.5))).toBeLessThanOrEqual(3);
    expect(Math.abs((area?.width ?? 0) - (box.width - 6.5))).toBeLessThanOrEqual(3);
    await page.mouse.up();
    // The pane landed in the bottom half, spanning the whole width, as the outline promised.
    const moved = page.locator(`[data-pane-id="${sourceId}"]`);
    await expect
      .poll(async () => (await moved.boundingBox())?.width ?? 0)
      .toBeGreaterThan(box.width - 4);
    const landed = await moved.boundingBox();
    expect((landed?.y ?? 0) + 2).toBeGreaterThan(box.y + box.height / 2 - 2);
    await expect(page.locator("html")).not.toHaveAttribute("data-pane-dragging");
  } finally {
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
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect.poll(() => held.some((raw) => raw.includes('"workspace.result"'))).toBe(true);
    await page.getByRole("button", { name: "Pane actions" }).click();
    const split = page.getByRole("menuitem", { name: "Split horizontally" });
    await expect(split).toBeDisabled();
    holding = false;
    for (const raw of held.splice(0)) deliver?.(raw);
    // CSS, not roles: an open menu hides the rest of the page from the accessibility tree.
    await expect(
      page.locator('[aria-label="Project tabs"] [data-tab-id] > button:first-child').nth(1),
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
