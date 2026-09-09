import { expect, test, type Page } from "@playwright/test";
import type {
  MobileHostMessage,
  MobileRendererMessage,
  NativeSurfaceEvent,
} from "@concors/client-core";

type Snapshot = Extract<MobileRendererMessage, { type: "native-surfaces" }>;
type TestWindow = Window & {
  nativeSnapshot?: Snapshot;
  concorsMobileReceive?(message: MobileHostMessage): void;
};
async function snapshot(page: Page) {
  return page.evaluate(() => (window as TestWindow).nativeSnapshot);
}
async function event(
  page: Page,
  kind: "button" | "composer",
  label: string,
  action: NativeSurfaceEvent,
) {
  const state = await snapshot(page);
  const surface = state?.surfaces.find(
    (item) =>
      item.content.kind === kind &&
      (kind === "composer" || (item.content.kind === "button" && item.content.label === label)),
  );
  expect(surface, `native surface ${label}`).toBeTruthy();
  const frame = page.frames().find((item) => item !== page.mainFrame());
  if (!state || !surface || !frame) throw new Error(`Missing native surface ${label}`);
  await frame.evaluate((message) => (window as TestWindow).concorsMobileReceive?.(message), {
    type: "native-event",
    scope: state.scope,
    connectionId: state.connectionId,
    surfaceId: surface.id,
    event: action,
  } satisfies MobileHostMessage);
}
test("native surface bridge preserves navigation, drafts, settings, attachments and submission", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      const message = event.data?.concorsMobile;
      if (window.parent !== window && message?.type === "state") {
        // Exercise the real native bridge contract without pretending Chromium renders SwiftUI.
        message.state.native = true;
        message.state.nativeChrome = true;
      } else if (window.parent === window && message?.type === "native-surfaces") {
        (window as TestWindow).nativeSnapshot = message;
      }
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await expect
    .poll(async () =>
      (await snapshot(page))?.surfaces.some((item) => item.content.kind === "composer"),
    )
    .toBe(true);
  await expect(ui.locator("[data-agent-composer]")).toHaveCount(0);
  await expect(ui.getByRole("button", { name: "Open sidebar", exact: true })).toHaveCount(0);
  const initial = await snapshot(page);
  if (!initial) throw new Error("No native snapshot");
  expect(initial?.surfaces.filter((item) => item.content.kind === "button")).toHaveLength(3);
  await event(page, "composer", "", { kind: "focus", focused: true });
  await event(page, "composer", "", { kind: "height", height: 144 });
  await event(page, "composer", "", {
    kind: "text",
    sequence: 1,
    text: "Native draft survives navigation",
  });
  await expect
    .poll(async () => {
      const content = (await snapshot(page))?.surfaces.find(
        (item) => item.content.kind === "composer",
      )?.content;
      return content?.kind === "composer"
        ? [content.draft, content.editAck, content.expanded]
        : null;
    })
    .toEqual(["Native draft survives navigation", 1, true]);
  await event(page, "button", "Project files", { kind: "press", control: "activate" });
  await expect(ui.locator(".mobile-files")).toHaveAttribute("data-open", "true");
  await expect
    .poll(async () =>
      (await snapshot(page))?.surfaces.map((item) =>
        item.content.kind === "button" ? item.content.label : "composer",
      ),
    )
    .toEqual(["Back to chat", "Browse project directory"]);
  await event(page, "button", "Back to chat", { kind: "swipe", direction: "right" });
  await expect(ui.locator(".mobile-files")).toHaveAttribute("data-open", "false");
  await expect
    .poll(async () =>
      (await snapshot(page))?.surfaces.some((item) => item.content.kind === "composer"),
    )
    .toBe(true);
  await event(page, "button", "Tabs and panes", { kind: "press", control: "activate" });
  await expect(ui.getByRole("dialog", { name: "Tabs and panes", exact: true })).toBeVisible();
  await expect.poll(async () => (await snapshot(page))?.surfaces).toEqual([]);
  // A delayed event from the covered native header cannot act through the drawer.
  const frame = page.frames().find((item) => item !== page.mainFrame());
  const oldFiles = initial.surfaces.find(
    (item) => item.content.kind === "button" && item.content.label === "Project files",
  );
  if (!frame || !oldFiles) throw new Error("No original Files surface");
  await frame.evaluate((message) => (window as TestWindow).concorsMobileReceive?.(message), {
    type: "native-event",
    scope: initial.scope,
    connectionId: initial.connectionId,
    surfaceId: oldFiles.id,
    event: { kind: "press", control: "activate" },
  } satisfies MobileHostMessage);
  await expect(ui.locator(".mobile-files")).toHaveAttribute("data-open", "false");
  await ui
    .getByRole("dialog", { name: "Tabs and panes", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await snapshot(page))?.surfaces.some((item) => item.content.kind === "composer"),
    )
    .toBe(true);
  await event(page, "composer", "", {
    kind: "attachments",
    attachments: [{ name: "note.txt", mime: "text/plain", data: "aGVsbG8=" }],
  });
  await expect(ui.getByRole("button", { name: "Remove note.txt" })).toBeVisible();
  await event(page, "composer", "", { kind: "press", control: "mode", value: "auto-review" });
  await expect
    .poll(async () => {
      const content = (await snapshot(page))?.surfaces.find(
        (item) => item.content.kind === "composer",
      )?.content;
      return content?.kind === "composer"
        ? content.controls
            .find((control) => control.id === "mode")
            ?.options?.find((option) => option.selected)?.id
        : null;
    })
    .toBe("auto-review");
  await ui.getByRole("button", { name: "Allow once", exact: true }).click();
  // Submit carries the last keystroke atomically, even before its separate text event is echoed.
  await event(page, "composer", "", {
    kind: "press",
    control: "send",
    text: "Native draft survives navigation!",
  });
  await expect(
    ui.getByText(/Native draft survives navigation!\s+Attached: note\.txt/),
  ).toBeVisible();
  await expect(ui.getByText(/This is a simulated response/)).toBeVisible();
  await expect
    .poll(async () => {
      const content = (await snapshot(page))?.surfaces.find(
        (item) => item.content.kind === "composer",
      )?.content;
      return content?.kind === "composer" ? content.draft : null;
    })
    .toBe("");
  expect(errors).toEqual([]);
});
