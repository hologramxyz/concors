import { expect, test, type Locator, type Page } from "@playwright/test";
import type { MobileHostMessage, MobileState } from "@concors/client-core";
import { swipe, scrollTimelineUp } from "./support/swipe";

test.setTimeout(180_000);

type TestWindow = Window & {
  auditState?: MobileState;
  concorsMobileReceive?(message: MobileHostMessage): void;
};

async function enter(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await expect(ui.locator(".mobile-shell")).toBeVisible();
  return ui;
}
async function pull(page: Page, drawer: Locator, distance = 190) {
  await expect(drawer).toBeVisible();
  // Wait for the entrance to finish before taking the handle's geometry.
  await expect
    .poll(() =>
      drawer.evaluate((el) =>
        el.getAnimations().every((animation) => animation.playState !== "running"),
      ),
    )
    .toBe(true);
  const box = await drawer.boundingBox();
  if (!box) throw new Error("Drawer is missing");
  await swipe(
    page,
    { x: box.x + box.width / 2, y: box.y + 15 },
    {
      x: box.x + box.width / 2,
      y: Math.min(box.y + 15 + distance, (page.viewportSize()?.height ?? 844) - 5),
    },
  );
}

test("opening and briefly reconnecting the workspace never flashes a reconnect notice", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      if (window.parent !== window && event.data?.concorsMobile?.type === "state")
        (window as TestWindow).auditState = event.data.concorsMobile.state;
    });
  });
  const ui = await enter(page);
  await expect(ui.getByText(/Reconnecting/)).toHaveCount(0);
  const frame = page.frames().find((frame) => frame !== page.mainFrame());
  if (!frame) throw new Error("Workspace renderer is missing");
  const phase = (phase: "ready" | "reconnecting") =>
    frame.evaluate((phase) => {
      const view = window as TestWindow;
      if (!view.auditState) throw new Error("Host state is missing");
      view.concorsMobileReceive?.({ type: "state", state: { ...view.auditState, phase } });
    }, phase);
  await page.clock.install();
  await phase("reconnecting");
  await page.clock.fastForward(1_000);
  await expect(ui.getByText(/Reconnecting/)).toHaveCount(0);
  await phase("ready");
  await page.clock.fastForward(2_000);
  await expect(ui.getByText(/Reconnecting/)).toHaveCount(0);
  await phase("reconnecting");
  await page.clock.fastForward(2_100);
  await expect(ui.getByText(/Reconnecting/)).toHaveCount(1);
  await expect(ui.locator(".mobile-notice")).toContainText("Saved workspace is read-only");
  await phase("ready");
  await expect(ui.getByText(/Reconnecting/)).toHaveCount(0);
});

test("model selection uses a full-width drawer with search and provider navigation", async ({
  page,
}) => {
  const ui = await enter(page);
  const draft = ui.getByRole("textbox", { name: "Message Codex" });
  await draft.fill("Keep my draft while choosing a model");
  const trigger = ui.getByRole("button", { name: "Agent and model", exact: true });
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  await trigger.click();
  const drawer = ui.getByRole("dialog", { name: "Agent and model", exact: true });
  await expect(drawer).toHaveAttribute("data-mobile-drawer", "true");
  await expect(drawer.getByRole("listbox", { name: "Models", exact: true })).toBeFocused();
  const search = drawer.getByRole("combobox", { name: "Search models" });
  await expect(search).not.toBeFocused();
  for (const [width, height] of [
    [320, 844],
    [430, 844],
    [390, 420],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() =>
        drawer.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return (
            Math.abs(box.left) < 1 &&
            Math.abs(box.right - innerWidth) < 1 &&
            Math.abs(box.bottom - innerHeight) < 1 &&
            box.top >= 0 &&
            el.scrollWidth <= el.clientWidth
          );
        }),
      )
      .toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill("No matching model");
  await expect(drawer.getByRole("option")).toHaveCount(0);
  await search.fill("");
  await drawer.getByRole("button", { name: "Back to providers" }).click();
  const providers = drawer.getByRole("listbox", { name: "Providers", exact: true });
  await expect(providers).toBeFocused();
  await drawer.getByRole("combobox", { name: "Search providers" }).fill("codex");
  await providers.getByRole("option", { name: /^Codex\b/ }).click();
  await expect(search).toHaveValue("");
  await drawer.getByRole("option", { name: "Codex", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(draft).toHaveValue("Keep my draft while choosing a model");
  await trigger.click();
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("every shared drawer pulls down to dismiss and restores its trigger", async ({ page }) => {
  const ui = await enter(page);
  const draft = ui.getByRole("textbox", { name: "Message Codex" });
  await draft.fill("Keep this draft while reviewing drawers");
  for (const name of ["Agent and model", "Workspaces", "New tab"]) {
    if (name === "Agent and model") await ui.getByRole("button", { name, exact: true }).click();
    else if (name === "Workspaces") await ui.getByRole("button", { name: /^Workspace: / }).click();
    else {
      await ui.getByRole("log", { name: "Chat timeline" }).click({ position: { x: 180, y: 250 } });
      await ui.getByRole("button", { name: "New tab", exact: true }).click();
    }
    const drawer = ui.getByRole("dialog", { name, exact: true });
    await pull(page, drawer);
    await expect(drawer).toHaveCount(0);
    await expect(draft).toHaveValue("Keep this draft while reviewing drawers");
  }
  await ui.locator("#mobile-sidebar-toggle").click();
  for (const name of ["Machine", "Search workspace", "Account"]) {
    const trigger =
      name === "Machine"
        ? ui.getByRole("combobox", { name, exact: true })
        : name === "Account"
          ? ui.getByRole("button", { name: /^Account:/ })
          : ui.getByRole("button", { name, exact: true });
    await trigger.click();
    const drawer = ui.getByRole("dialog", {
      name: name === "Search workspace" ? "Search" : name,
      exact: true,
    });
    await pull(page, drawer);
    await expect(drawer).toHaveCount(0);
    await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
    await expect(trigger).toBeFocused();
  }
  await ui.getByRole("button", { name: /^Account:/ }).click();
  await ui.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  await pull(page, settings);
  await expect(settings).toHaveCount(0);
  await expect(draft).toHaveValue("Keep this draft while reviewing drawers");
});

test("short and cancelled drawer pulls spring back; scrolled content keeps its gesture", async ({
  page,
}) => {
  const ui = await enter(page);
  await ui.locator("#mobile-sidebar-toggle").click();
  await ui.getByRole("button", { name: /^Account:/ }).click();
  const account = ui.getByRole("dialog", { name: "Account", exact: true });
  await pull(page, account, 20);
  await expect(account).toBeVisible();
  await expect(account).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await ui.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  const body = settings.locator(".mobile-settings-body");
  await body.evaluate((el) => {
    el.scrollTop = 250;
  });
  const box = await body.boundingBox();
  if (!box) throw new Error("Settings body is missing");
  await swipe(page, { x: box.x + 100, y: box.y + 140 }, { x: box.x + 100, y: box.y + 230 });
  await expect(settings).toBeVisible();
  expect(await settings.getAttribute("data-mobile-drawer-dragged")).toBeNull();
  const handle = await settings.locator(".mobile-drawer-handle").boundingBox();
  if (!handle) throw new Error("Drawer handle is missing");
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 180, y: handle.y + 15 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 180, y: handle.y + 100 }],
    });
    await expect(settings).toHaveAttribute("data-dragging", "true");
    await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(settings).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  } finally {
    await touch.detach();
  }
  await pull(page, settings);
  await expect(settings).toHaveCount(0);
});

test("idle primary action records, text and attachments send, and active turns stop", async ({
  page,
}) => {
  const ui = await enter(page);
  const primary = ui.locator(".mobile-composer-primary button");
  await expect(primary).toHaveAttribute("aria-label", "Interrupt agent");
  await ui.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(primary).toHaveAttribute("aria-label", "Start dictation");
  const input = ui.getByRole("textbox", { name: "Message Codex" });
  await input.fill("Ready to send");
  await expect(primary).toHaveAttribute("aria-label", "Send message");
  await input.fill("   ");
  await expect(primary).toHaveAttribute("aria-label", "Start dictation");
  await ui
    .locator('input[type="file"]')
    .setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("A note") });
  await expect(primary).toHaveAttribute("aria-label", "Send message");
  await expect(primary).toBeEnabled();
});

test("Latest stays above the entire native composer footer at phone and keyboard heights", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      if (window.parent !== window && event.data?.concorsMobile?.type === "state")
        event.data.concorsMobile.state.nativeChrome = true;
    });
  });
  const ui = await enter(page);
  const timeline = ui.getByRole("log", { name: "Chat timeline" });
  for (const height of [851, 430]) {
    await page.setViewportSize({ width: 393, height });
    await scrollTimelineUp(page, timeline);
    const latest = ui.getByRole("button", { name: "Latest", exact: true });
    await expect(latest).toBeVisible();
    await expect
      .poll(async () => {
        const button = await latest.boundingBox();
        const footer = await ui.locator("[data-chat-footer]").boundingBox();
        return !!button && !!footer && button.y + button.height <= footer.y;
      })
      .toBe(true);
    await latest.click();
    await expect(latest).toHaveCount(0);
  }
});
