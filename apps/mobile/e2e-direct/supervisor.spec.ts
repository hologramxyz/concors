import type { MobileRendererMessage, MobileHostMessage } from "@concors/client-core";
import { test, expect } from "./fixtures";

test("mobile Supervisor uses the shared chat and composer through the native relay", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Supervisor", exact: true }).click();
  await expect(ui.getByTestId("supervisor-page")).toBeVisible();
  const composer = ui.getByRole("textbox", { name: /Message / });
  await expect(composer).toBeVisible();
  await composer.fill("Find the chat about our mobile release");
  await ui.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(ui.getByRole("log")).toContainText("Hello from");
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await ui
        .getByTestId("supervisor-page")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath("supervisor-mobile.png") });
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("supervisor-mobile-sidebar.png") });
  await ui.getByRole("button", { name: "Schedules", exact: true }).click();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Supervisor", exact: true }).click();
  await expect(ui.getByRole("log")).toContainText("Find the chat about our mobile release");
  await expect(composer).toBeVisible();
});

// Chromium exercises the bridge contract; it does not emulate the SwiftUI keyboard.
test("Supervisor exposes its composer to the native mobile host", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      const message = event.data?.concorsMobile;
      if (window.parent !== window && message?.type === "state") {
        message.state.native = true;
        message.state.nativeChrome = true;
      } else if (window.parent === window && message?.type === "native-surfaces") {
        (window as Window & { supervisorSnapshot?: unknown }).supervisorSnapshot = message;
      }
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  const snapshot = () =>
    page.evaluate(
      () =>
        (
          window as Window & {
            supervisorSnapshot?: Extract<MobileRendererMessage, { type: "native-surfaces" }>;
          }
        ).supervisorSnapshot,
    );
  await expect
    .poll(async () =>
      (await snapshot())?.surfaces.some(
        (s) => s.content.kind === "button" && s.content.label === "Open sidebar",
      ),
    )
    .toBe(true);
  const menuState = await snapshot();
  const menu = menuState?.surfaces.find(
    (s) => s.content.kind === "button" && s.content.label === "Open sidebar",
  );
  const menuFrame = page.frames().find((f) => f !== page.mainFrame());
  if (!menuState || !menu || !menuFrame) throw new Error("Missing native sidebar button");
  await menuFrame.evaluate(
    (message) =>
      (
        window as Window & { concorsMobileReceive?(value: MobileHostMessage): void }
      ).concorsMobileReceive?.(message),
    {
      type: "native-event",
      scope: menuState.scope,
      connectionId: menuState.connectionId,
      surfaceId: menu.id,
      event: { kind: "press", control: "activate" },
    } satisfies MobileHostMessage,
  );
  await ui.getByRole("button", { name: "Supervisor", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot())?.surfaces.some((s) => s.content.kind === "composer" && s.content.editable),
    )
    .toBe(true);
  const state = await snapshot();
  const composer = state?.surfaces.find((s) => s.content.kind === "composer");
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!state || !composer || !frame) throw new Error("Missing Supervisor native composer");
  const text = "Find work across my projects";
  for (const event of [
    { kind: "text", text, sequence: 1 },
    { kind: "press", control: "send", text },
  ] as const) {
    await frame.evaluate(
      (message) =>
        (
          window as Window & {
            concorsMobileReceive?(value: MobileHostMessage): void;
          }
        ).concorsMobileReceive?.(message),
      {
        type: "native-event",
        scope: state.scope,
        connectionId: state.connectionId,
        surfaceId: composer.id,
        event,
      } satisfies MobileHostMessage,
    );
  }
  await expect(ui.getByRole("log")).toContainText(text);
});
