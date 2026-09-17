import { expect, test, type Page } from "@playwright/test";
import type { MobileRendererMessage } from "@concors/client-core";

type Snapshot = Extract<MobileRendererMessage, { type: "native-surfaces" }>;
type TestWindow = Window & { nativeSnapshot?: Snapshot };
const snapshot = (page: Page) => page.evaluate(() => (window as TestWindow).nativeSnapshot);

async function enter(page: Page, native: boolean) {
  await page.addInitScript((nativeChrome) => {
    window.addEventListener("message", (event) => {
      const message = event.data?.concorsMobile;
      if (window.parent !== window && message?.type === "state") {
        message.state.nativeChrome = nativeChrome;
        message.state.safeArea = { top: 59, bottom: 34, left: 0, right: 0 };
      } else if (window.parent === window && message?.type === "native-surfaces") {
        (window as TestWindow).nativeSnapshot = message;
      }
    });
  }, native);
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await expect(ui.locator(".mobile-shell")).toBeVisible();
  return ui;
}

test("iPhone backgrounds fill the screen while controls respect notch and home indicator", async ({
  page,
}) => {
  const ui = await enter(page, false);
  const measure = () =>
    ui.locator(".mobile-shell").evaluate((shell) => {
      const element = (selector: string) => {
        const found = shell.querySelector(selector);
        if (!found) throw new Error(`Missing layout element ${selector}`);
        return found;
      };
      const rect = (selector: string) => element(selector).getBoundingClientRect().toJSON();
      return {
        shell: shell.getBoundingClientRect().toJSON(),
        viewport: innerHeight,
        menu: rect("#mobile-sidebar-toggle"),
        files: rect("#mobile-files-toggle"),
        sidebar: rect(".mobile-sidebar"),
        search: rect('[aria-label="Search workspace"]'),
        picker: rect(".mobile-sidebar-machine button"),
        footer: rect(".mobile-sidebar-footer"),
        footerPadding: getComputedStyle(element(".mobile-sidebar-footer")).paddingBottom,
        panePadding: getComputedStyle(element(".mobile-pane")).paddingBottom,
      };
    });
  await expect.poll(async () => (await measure()).menu.y).toBe(71);
  const metrics = await measure();
  expect(metrics.shell.y).toBe(0);
  expect(metrics.shell.height).toBe(metrics.viewport);
  expect(metrics.sidebar.height).toBe(metrics.viewport);
  expect(metrics.footer.bottom).toBe(metrics.viewport);
  expect(metrics.footerPadding).toBe("34px");
  expect(metrics.panePadding).toBe("34px");
  for (const control of [metrics.menu, metrics.files, metrics.search, metrics.picker]) {
    expect(control.height).toBe(44);
    expect(control.y).toBe(metrics.menu.y);
  }
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("iphone-safe-area-sidebar.png") });
  await ui.getByRole("button", { name: /^Account:/ }).click();
  const account = ui.getByRole("dialog", { name: "Account", exact: true });
  await expect(account).toHaveCSS("padding-bottom", "34px");
});

test("native header surfaces follow both panels throughout real touch drags", async ({ page }) => {
  const ui = await enter(page, true);
  await expect
    .poll(async () =>
      (await snapshot(page))?.surfaces.some((item) => item.content.kind === "composer"),
    )
    .toBe(true);
  const touch = await page.context().newCDPSession(page);
  let touching = false;
  const move = (x: number) =>
    touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: 300 }] });
  const start = async (x: number) => {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: 300 }],
    });
    touching = true;
  };
  const end = async () => {
    if (!touching) return;
    touching = false;
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const button = async (label: string) =>
    (await snapshot(page))?.surfaces.find(
      (item) => item.content.kind === "button" && item.content.label === label,
    );
  try {
    await start(25);
    await move(150);
    await move(310);
    await expect(ui.locator(".mobile-workspace")).toHaveAttribute("data-dragging", "true");
    await expect
      .poll(async () => (await button("Search workspace"))?.clip?.width ?? 0)
      .toBeGreaterThan(0);
    const search = await button("Search workspace");
    const menu = await button("Open sidebar");
    if (!menu || !search?.clip) throw new Error("Expected both partially revealed headers");
    expect(search.clip.x + search.clip.width).toBeLessThanOrEqual(menu.frame.x);
    await end();
    await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
    await expect.poll(async () => (await button("Open sidebar"))?.interactive).toBe(false);
    // Close halfway: search is clipped, not painted on top of the moving workspace.
    await start(340);
    await move(275);
    await expect
      .poll(async () => (await button("Search workspace"))?.clip?.width ?? 0)
      .toBeLessThan(44);
    await move(30);
    await end();
    await expect.poll(async () => await button("Search workspace")).toBeUndefined();
    await expect.poll(async () => (await button("Open sidebar"))?.interactive).toBe(true);
    // Incoming Files controls are visible before the drag commits (panel is still inert).
    await start(350);
    await move(180);
    await expect.poll(async () => !!(await button("Back to chat"))).toBe(true);
    expect((await button("Back to chat"))?.interactive).toBe(false);
    await expect.poll(async () => await button("Project files")).toBeUndefined();
    await move(25);
    await end();
    await expect(ui.locator(".mobile-files")).toHaveAttribute("data-open", "true");
    await expect.poll(async () => (await button("Back to chat"))?.interactive).toBe(true);
    await start(25);
    await move(210);
    await expect.poll(async () => !!(await button("Open sidebar"))).toBe(true);
    await move(370);
    await end();
    await expect(ui.locator(".mobile-files")).toHaveAttribute("data-open", "false");
    await expect.poll(async () => await button("Back to chat")).toBeUndefined();
  } finally {
    await end();
    await touch.detach();
  }
});
