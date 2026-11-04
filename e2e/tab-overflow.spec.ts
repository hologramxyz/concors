import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { closeTab, tab, tabs } from "./support/tabs.ts";

const TAB_COUNT = 16;

const strip = (page: Page) =>
  page.getByLabel("Project tabs", { exact: true }).locator(".tab-strip");
const fade = (page: Page, edge: "start" | "end") => page.locator(`[data-tab-fade="${edge}"]`);
const scrollLeft = (page: Page) => strip(page).evaluate((element) => element.scrollLeft);
const scrollTo = (page: Page, left: number) =>
  strip(page).evaluate((element, target) => {
    element.scrollLeft = target;
  }, left);
const maxScroll = (page: Page) =>
  strip(page).evaluate((element) => element.scrollWidth - element.clientWidth);

async function expectFades(page: Page, start: boolean, end: boolean) {
  await expect(fade(page, "start")).toHaveAttribute("data-visible", String(start));
  await expect(fade(page, "end")).toHaveAttribute("data-visible", String(end));
}

/** The active tab is wholly inside the strip and its close button clears both visible fades. */
async function expectActiveInView(page: Page) {
  await expect
    .poll(() =>
      strip(page).evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const active = element.querySelector("[data-active-tab]")?.getBoundingClientRect();
        const close = element
          .querySelector("[data-active-tab] button[aria-label^='Close']")
          ?.getBoundingClientRect();
        if (!active || !close) return "no active tab";
        if (active.left < bounds.left - 1 || active.right > bounds.right + 1) return "clipped";
        const atEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
        if (!atEnd && close.right > bounds.right - 28) return "under the end fade";
        return "in view";
      }),
    )
    .toBe("in view");
}

async function openTerminals(page: Page, total: number) {
  for (let index = await tabs(page).count(); index < total; index += 1) {
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect(tab(page, index)).toHaveAttribute("aria-pressed", "true");
    // The tab bar stays reachable after every tab, and the newest one is fully on show.
    await expectActiveInView(page);
  }
}

/**
 * Sends a drag event straight to the element under the point. Playwright's emulated drag stops
 * delivering dragover part-way through in some runs; these handlers are what is on test.
 */
async function sendDrag(page: Page, type: string, x: number, y: number) {
  await page.evaluate(
    ([type, x, y]) => {
      const target = document.elementFromPoint(x as number, y as number);
      target?.dispatchEvent(
        new DragEvent(type as string, {
          bubbles: true,
          cancelable: true,
          clientX: x as number,
          clientY: y as number,
          dataTransfer: new DataTransfer(),
        }),
      );
    },
    [type, x, y],
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("the tab strip scrolls without a scrollbar, fades its edges and keeps the active tab in view", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-overflow-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Tab overflow", directory);
    await expect(tabs(page)).toHaveCount(1);
    const bar = page.locator('[data-tour="tabs"]');
    const height = (await bar.boundingBox())?.height;
    await expectFades(page, false, false);

    await openTerminals(page, TAB_COUNT);

    // Same bar height, no scrollbar taking room inside the strip.
    expect((await bar.boundingBox())?.height).toBe(height);
    expect(await maxScroll(page)).toBeGreaterThan(0);
    await expect
      .poll(() => strip(page).evaluate((element) => element.offsetHeight - element.clientHeight))
      .toBe(0);
    await expectFades(page, true, false);

    // "+ ⌄" is pinned right after the strip, not scrolled away with the tabs.
    const newTab = page.getByRole("button", { name: "New tab", exact: true });
    const pinned = async () => {
      const button = await newTab.boundingBox();
      const list = await strip(page).boundingBox();
      expect(button && list && button.x - (list.x + list.width)).toBeGreaterThanOrEqual(0);
      expect(button && list && button.x - (list.x + list.width)).toBeLessThan(8);
    };
    await pinned();

    // A plain vertical wheel moves it sideways.
    await scrollTo(page, 0);
    await expectFades(page, false, true);
    await pinned();
    await strip(page).hover();
    await page.mouse.wheel(0, 150);
    await expect.poll(() => scrollLeft(page)).toBe(150);
    await expectFades(page, true, true);
    // So do a sideways swipe and Shift+wheel.
    await page.mouse.wheel(60, 0);
    await expect.poll(() => scrollLeft(page)).toBe(210);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 40);
    await page.keyboard.up("Shift");
    await expect.poll(() => scrollLeft(page)).toBe(250);

    // A fade takes no clicks: the tab under it can be chosen.
    await scrollTo(page, 0);
    const end = await fade(page, "end").boundingBox();
    expect(end?.width).toBe(28);
    await expect
      .poll(() =>
        page.evaluate(
          ([x, y]) =>
            document.elementFromPoint(x as number, y as number)?.hasAttribute("data-tab-fade"),
          [(end?.x ?? 0) + 14, (end?.y ?? 0) + (end?.height ?? 0) / 2],
        ),
      )
      .toBe(false);

    // Keyboard: wrapping forward from the last tab lands on the first, far away.
    await scrollTo(page, await maxScroll(page));
    await tab(page, TAB_COUNT - 1).click();
    await page.keyboard.press("Control+Shift+t");
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, 0)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => scrollLeft(page)).toBe(0);
    await expectActiveInView(page);

    // Selecting from the sidebar reaches a tab scrolled off the far end.
    const row = page.getByRole("navigation", { name: "Primary" }).locator(
      `button[data-sidebar-tab-id="${await tabs(page)
        .nth(TAB_COUNT - 1)
        .getAttribute("data-tab-id")}"]`,
    );
    await row.click();
    await expect(tab(page, TAB_COUNT - 1)).toHaveAttribute("aria-pressed", "true");
    await expectActiveInView(page);
    await expect.poll(() => scrollLeft(page)).toBe(await maxScroll(page));

    // Scrolling away from the active tab, then closing a tab there, leaves the strip alone.
    await scrollTo(page, 0);
    await tab(page, 0).hover();
    await closeTab(page, 0).click();
    await expect(tabs(page)).toHaveCount(TAB_COUNT - 1);
    await expect.poll(() => scrollLeft(page)).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dragging the active tab scrolls the strip at its edge and keeps the tab in view", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-overflow-drag-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Tab overflow drag", directory);
    await expect(tabs(page)).toHaveCount(1);
    await openTerminals(page, TAB_COUNT);
    await tab(page, 0).click();
    await expect.poll(() => scrollLeft(page)).toBe(0);
    const dragged = await tabs(page).nth(0).getAttribute("data-tab-id");

    const start = await centre(tab(page, 0));
    const list = await strip(page).boundingBox();
    if (!list) throw new Error("No tab strip");
    await sendDrag(page, "dragstart", start.x, start.y);
    // Held at the right edge, the strip scrolls under the tab until it reaches the end.
    const edge = list.x + list.width - 4;
    const max = await maxScroll(page);
    // dragstart publishes the drag on the next frame, so the first dragover already counts.
    for (let held = 0; held < 200 && (await scrollLeft(page)) < max - 1; held += 1)
      await sendDrag(page, "dragover", edge, start.y);
    expect(await scrollLeft(page)).toBeGreaterThanOrEqual(max - 1);
    // The strip followed the tab's landing slot, so the slot is on show before the drop.
    await expect
      .poll(async () => {
        await sendDrag(page, "dragover", edge, start.y);
        return tabs(page)
          .last()
          .evaluate((element) => (element as HTMLElement).style.transform);
      })
      .not.toBe("translateX(0px)");
    await sendDrag(page, "drop", edge, start.y);
    await sendDrag(page, "dragend", edge, start.y);

    await expect.poll(() => tabs(page).last().getAttribute("data-tab-id")).toBe(dragged);
    await expect(tab(page, TAB_COUNT - 1)).toHaveAttribute("aria-pressed", "true");
    await expectActiveInView(page);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const NAMES = [
  "Build",
  "Review auth flow",
  "Docs",
  "Fix flaky e2e",
  "Release notes",
  "Tests",
  "Migrate billing tables",
  "Logs",
  "Refactor sidebar",
  "Deploy",
  "Pricing page copy",
  "Lint",
  "Dependency upgrades",
  "API",
  "Onboarding tour",
  "Scratch",
];

test.describe("screenshots", () => {
  test.use({ deviceScaleFactor: 2 });

  for (const colorScheme of ["light", "dark"] as const)
    test(`overflowing tabs read cleanly in ${colorScheme}`, async ({ page }) => {
      test.setTimeout(120_000);
      const directory = await mkdtemp(join(tmpdir(), `concors-tab-overflow-${colorScheme}-`));
      try {
        await signedIn(page);
        await page.emulateMedia({ colorScheme });
        await page.goto("/");
        await seedProject(page, "Tab overflow themes", directory);
        await expect(tabs(page)).toHaveCount(1);
        await openTerminals(page, NAMES.length);
        for (const [index, name] of NAMES.entries()) {
          await tabs(page).nth(index).scrollIntoViewIfNeeded();
          await tab(page, index).dblclick();
          await page.getByLabel("Tab name", { exact: true }).fill(name);
          await page.keyboard.press("Enter");
          await expect(tab(page, index)).toContainText(name);
        }
        const shoot = async (place: string, left: number, start: boolean, end: boolean) => {
          await scrollTo(page, left);
          // The tab nearest the middle of what is on show becomes the active one.
          const middle = await tabs(page).evaluateAll((all) => {
            const strip = all[0]?.closest(".tab-strip")?.getBoundingClientRect();
            const centre = (strip?.left ?? 0) + (strip?.width ?? 0) / 2;
            const distance = (element: Element) => {
              const box = element.getBoundingClientRect();
              return Math.abs(box.left + box.width / 2 - centre);
            };
            const distances = all.map(distance);
            return distances.indexOf(Math.min(...distances));
          });
          await tab(page, middle).click();
          await expectActiveInView(page);
          await expect.poll(() => scrollLeft(page)).toBe(left);
          await expectFades(page, start, end);
          await expect(fade(page, "end")).toHaveCSS("opacity", end ? "1" : "0");
          await expect(fade(page, "start")).toHaveCSS("opacity", start ? "1" : "0");
          await page.mouse.move(700, 500);
          await page.screenshot({
            path: test.info().outputPath(`tabs-${colorScheme}-${place}.png`),
            clip: { x: 0, y: 0, width: 1360, height: 120 },
          });
        };
        const max = await maxScroll(page);
        await shoot("start", 0, false, true);
        await shoot("middle", Math.round(max / 2), true, true);
        // Scrolled by hand, the active tab goes under the end fade like any other tab.
        await shoot("middle-for-fade", Math.round(max / 2), true, true);
        await strip(page).evaluate((element) => {
          const active = element.querySelector<HTMLElement>("[data-active-tab]");
          if (active)
            element.scrollLeft = active.offsetLeft + active.offsetWidth - element.clientWidth + 8;
        });
        await expectFades(page, true, true);
        await page.locator("[data-active-tab]").hover();
        await page.screenshot({
          path: test.info().outputPath(`tabs-${colorScheme}-active-under-fade.png`),
          clip: { x: 0, y: 0, width: 1360, height: 120 },
        });
        await shoot("end", max, true, false);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
});
