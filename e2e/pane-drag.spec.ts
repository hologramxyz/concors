import { seedProject } from "./support/projects.ts";
import type { Locator, Page } from "@playwright/test";
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

/** Opens a terminal tab split into `layout`, its panes in the order the layout reads. */
async function splitTab(page: Page, layout: "three" | "grid") {
  await page.getByRole("button", { name: "New tab options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
  await expect(tab(page, 1)).toHaveAttribute("aria-pressed", "true");
  const panes = page.locator("[data-pane-id]").filter({ visible: true });
  const splitPane = async (index: number, name: string, count: number) => {
    await panes.nth(index).getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name }).click();
    await expect(panes).toHaveCount(count);
  };
  await splitPane(0, "Split horizontally", 2);
  // A | B over C, or A over C | B over D. Later panes first, as splitting renumbers those after.
  await splitPane(1, "Split vertically", 3);
  if (layout === "grid") await splitPane(0, "Split vertically", 4);
  const ids = await panes.evaluateAll((all) =>
    all.map((pane) => pane.getAttribute("data-pane-id")),
  );
  return ids.map((id) => page.locator(`[data-pane-id="${id}"]`));
}

const box = async (locator: Locator) => {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Not visible");
  return bounds;
};

function expectNear(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
  tolerance = 9,
) {
  for (const key of ["x", "y", "width", "height"] as const)
    expect(Math.abs(actual[key] - expected[key]), key).toBeLessThanOrEqual(tolerance);
}

/** Holds a pane's header over a share of another element. Nothing is released yet. */
async function dragOver(page: Page, source: Locator, over: Locator, sx: number, sy: number) {
  const header = await box(source.locator("header"));
  const target = await box(over);
  await page.mouse.move(header.x + 60, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * sx, target.y + target.height * sy, { steps: 4 });
}

/** The process in a terminal, which a restarted session would change. */
async function shellProcess(page: Page, pane: Locator, marker: string) {
  await pane.locator("textarea").focus();
  await page.keyboard.type(`echo ${marker}:$$:`);
  await page.keyboard.press("Enter");
  const output = pane.getByLabel("Terminal output").filter({ visible: true });
  await expect(output).toContainText(new RegExp(`${marker}:\\d+:`));
  return (await output.textContent())?.match(new RegExp(`${marker}:(\\d+):`))?.[1];
}

const preview = (page: Page) => page.getByTestId("pane-drop-preview");

test("in a 2×2 layout a pane's edge splits only that pane and its centre swaps", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-grid-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Grid", directory);
    const [a, c, b, d] = (await splitTab(page, "grid")) as [Locator, Locator, Locator, Locator];
    const dId = await d.getAttribute("data-pane-id");
    const process = await shellProcess(page, a, "BEFORE");

    // Each edge of D shows half of D, in that direction.
    const start = await box(d);
    for (const [placement, sx, sy, expected] of [
      ["left", 0.1, 0.5, { ...start, width: start.width / 2 }],
      ["right", 0.9, 0.5, { ...start, x: start.x + start.width / 2, width: start.width / 2 }],
      ["top", 0.5, 0.1, { ...start, height: start.height / 2 }],
      ["bottom", 0.5, 0.9, { ...start, y: start.y + start.height / 2, height: start.height / 2 }],
    ] as const) {
      await dragOver(page, a, d, sx, sy);
      await expect(preview(page)).toHaveCount(1);
      await expect(preview(page)).toHaveAttribute("data-scope", "pane");
      await expect(preview(page)).toHaveAttribute("data-placement", placement);
      await expect(preview(page)).toHaveAttribute("data-target-pane", dId ?? "");
      expectNear(await box(preview(page)), expected);
      await page.keyboard.press("Escape");
      await page.mouse.up();
    }
    await expect(preview(page)).toHaveCount(0);
    expectNear(await box(d), start, 1);

    // A centre shows the whole pane, and swapping changes no other pane's place.
    const [aBefore, bBefore, cBefore] = [await box(a), await box(b), await box(c)];
    await dragOver(page, a, d, 0.5, 0.5);
    await expect(preview(page)).toHaveAttribute("data-placement", "center");
    expectNear(await box(preview(page)), start);
    await page.mouse.up();
    await expect
      .poll(async () => (await a.boundingBox())?.x ?? Number.NaN)
      .toBeGreaterThan(start.x - 2);
    expectNear(await box(a), start, 2);
    expectNear(await box(d), aBefore, 2);
    expectNear(await box(b), bBefore, 2);
    expectNear(await box(c), cBefore, 2);

    // Dropping on an edge splits that pane alone. A now shares a column with B, which closes up.
    const cStart = await box(c);
    const dStill = await box(d);
    await dragOver(page, a, c, 0.9, 0.5);
    await expect(preview(page)).toHaveAttribute("data-placement", "right");
    const area = await box(preview(page));
    expectNear(area, { ...cStart, x: cStart.x + cStart.width / 2, width: cStart.width / 2 });
    await page.mouse.up();
    await expect.poll(async () => (await a.boundingBox())?.x ?? Number.NaN).toBeLessThan(start.x);
    expectNear(await box(a), area);
    expect((await box(c)).width).toBeLessThan(cStart.width * 0.6);
    expectNear(await box(d), dStill, 2);
    expect((await box(b)).height).toBeGreaterThan(bBefore.height * 1.5);
    await expect(page.locator("[data-pane-id]").filter({ visible: true })).toHaveCount(4);

    // The session in the moved pane never restarted.
    expect(await shellProcess(page, a, "AFTER")).toBe(process);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("in a 3-pane layout edge and centre drops land where the outline showed", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-edges-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Edges", directory);
    const [a, b, c] = (await splitTab(page, "three")) as [Locator, Locator, Locator];
    const process = await shellProcess(page, b, "BEFORE");

    // B leaves its stack for A's right half; C takes B's old place too.
    const aStart = await box(a);
    await dragOver(page, b, a, 0.9, 0.5);
    await expect(preview(page)).toHaveAttribute(
      "data-target-pane",
      (await a.getAttribute("data-pane-id")) ?? "",
    );
    const edge = await box(preview(page));
    expectNear(edge, { ...aStart, x: aStart.x + aStart.width / 2, width: aStart.width / 2 });
    await page.mouse.up();
    await expect
      .poll(async () => (await b.boundingBox())?.x ?? Number.NaN)
      .toBeLessThan(aStart.x + aStart.width);
    expectNear(await box(b), edge);
    expect(await shellProcess(page, b, "AFTER")).toBe(process);

    // C swaps with B, and they trade places exactly.
    const [bBefore, cBefore] = [await box(b), await box(c)];
    await dragOver(page, c, b, 0.5, 0.5);
    await expect(preview(page)).toHaveAttribute("data-placement", "center");
    expectNear(await box(preview(page)), bBefore);
    await page.mouse.up();
    await expect.poll(async () => (await c.boundingBox())?.x ?? Number.NaN).toBeLessThan(cBefore.x);
    expectNear(await box(c), bBefore, 2);
    expectNear(await box(b), cBefore, 2);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("beside its former neighbour the outline shows the grown space, and bad drops cancel", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-neighbour-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Neighbour", directory);
    const [a, c, b] = (await splitTab(page, "grid")) as [Locator, Locator, Locator];
    const workspace = page.getByTestId("pane-workspace").filter({ visible: true });
    const before = await box(a);

    // Over its own pane there is nothing to do, and letting go there moves nothing.
    await dragOver(page, a, a, 0.5, 0.5);
    await expect(preview(page)).toHaveCount(0);
    await page.mouse.up();
    expectNear(await box(a), before, 1);

    // Outside the workspace too.
    const area = await box(workspace);
    const header = await box(a.locator("header"));
    await page.mouse.move(header.x + 60, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(area.x - 30, area.y + 100, { steps: 4 });
    await expect(preview(page)).toHaveCount(0);
    await page.mouse.up();
    expectNear(await box(a), before, 1);

    // Escape cancels a centre as well as an edge.
    await dragOver(page, a, b, 0.5, 0.5);
    await expect(preview(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expectNear(await box(a), before, 1);

    // C grows into A's place when A leaves, so A takes half of the whole column, not half of C.
    const column = { ...before, height: (await box(c)).y + (await box(c)).height - before.y };
    await dragOver(page, a, c, 0.9, 0.5);
    await expect(preview(page)).toHaveAttribute("data-placement", "right");
    const shown = await box(preview(page));
    expectNear(shown, { ...column, x: column.x + column.width / 2, width: column.width / 2 });
    await page.mouse.up();
    await expect
      .poll(async () => (await a.boundingBox())?.x ?? Number.NaN)
      .toBeGreaterThan(before.x + 10);
    expectNear(await box(a), shown);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
