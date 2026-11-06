import { expect, test, type Page } from "@playwright/test";
import type {
  MobileHostMessage,
  MobileRendererMessage,
  NativeSurfaceEvent,
} from "@concors/client-core";
import { SIDEBAR_TREE_FLAG, treeIds } from "../src/demo/fixtures";

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
async function composer(page: Page) {
  const content = (await snapshot(page))?.surfaces.find(
    (item) => item.content.kind === "composer",
  )?.content;
  return content?.kind === "composer" ? content : null;
}
async function openNativeDemo(page: Page, query = "") {
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
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "Explore demo" }).click();
  await expect.poll(async () => !!(await composer(page))).toBe(true);
  return page.frameLocator('iframe[title="Concors workspace"]');
}
test("the native workspace switcher lists open workspaces and answers with the chosen one", async ({
  page,
}) => {
  const ui = await openNativeDemo(page, `?${SIDEBAR_TREE_FLAG}`);
  const menu = async () => {
    const surface = (await snapshot(page))?.surfaces.find(
      (item) => item.content.kind === "button" && item.content.label === "Workspace",
    );
    return surface?.content.kind === "button" ? surface.content : null;
  };
  // The pill names the workspace and carries the sheet iPhone draws in place of the web one.
  await expect.poll(async () => (await menu())?.title).toBe("Concors");
  const options = (await menu())?.menu?.options ?? [];
  expect((await menu())?.menu?.title).toBe("Workspaces");
  expect(
    options.map(({ label, description, selected }) => ({ label, description, selected })),
  ).toEqual([
    { label: "Concors", description: "alex", selected: true },
    { label: "Concors", description: "forks", selected: false },
    { label: "Open workspace…", description: undefined, selected: false },
  ]);
  // The sidebar's fallback mark (no favicon in SwiftUI) and its dots: a question here, a
  // finished chat in the fork.
  expect(options[0]).toMatchObject({ mark: "folder", dot: "attention" });
  expect(options[1]).toMatchObject({ mark: "folder", dot: "done" });
  expect(options[2]).toMatchObject({ section: true });
  // Choosing a row switches workspace; the web sheet never opens.
  await event(page, "button", "Workspace", {
    kind: "press",
    control: "workspace",
    value: treeIds.fork,
  });
  await expect(ui.locator('.mobile-tab-strip [data-pane-choice][aria-pressed="true"]')).toHaveText(
    "Try the new parser",
  );
  await expect(ui.getByRole("dialog", { name: "Workspaces" })).toHaveCount(0);
  await expect.poll(async () => (await menu())?.menu?.options?.[1]?.selected).toBe(true);
  // The last row opens the sidebar's "+" sheet.
  await event(page, "button", "Workspace", {
    kind: "press",
    control: "workspace",
    value: "open-workspace",
  });
  await expect(ui.getByRole("dialog", { name: "Open workspace", exact: true })).toBeVisible();
});
test("native model pages distinguish provider navigation from a committed model choice", async ({
  page,
}) => {
  await openNativeDemo(page);
  const control = async (id: string) =>
    (await composer(page))?.controls.find((item) => item.id === id);
  await expect
    .poll(async () =>
      (await control("model"))?.options?.find((option) => option.id === "model:providers"),
    )
    .toMatchObject({ label: "Provider", value: "Codex", navigate: true, section: true });
  await expect.poll(async () => (await control("model:providers"))?.title).toBe("Providers");
  await event(page, "composer", "", { kind: "press", control: "model:providers", value: "codex" });
  await expect.poll(async () => (await control("model"))?.title).toBe("Codex");
  await expect
    .poll(async () =>
      (await control("model"))?.options?.some(
        (option) => option.id === "demo-codex" && !option.navigate,
      ),
    )
    .toBe(true);
});
test("native menus word their titles and rows as desktop does", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openNativeDemo(page);
  const control = async (id: string) =>
    (await composer(page))?.controls.find((item) => item.id === id);
  const rows = async (id: string) =>
    (await control(id))?.options?.map((option) =>
      option.selected ? `✓ ${option.label}` : option.label,
    );
  const options = async () =>
    (await control("options"))?.options?.map((option) =>
      option.toggle
        ? `${option.label}: ${option.selected ? "on" : "off"}`
        : `${option.label}: ${option.value}`,
    );
  await expect.poll(() => rows("effort")).toEqual(["Default (medium)", "Low", "✓ Medium", "High"]);
  expect((await control("effort"))?.title).toBe("Thinking effort");
  expect((await control("mode"))?.title).toBe("Permission mode");
  expect(await rows("mode")).toEqual(["✓ Default permissions", "Auto-review", "Full access"]);
  expect((await control("speed"))?.title).toBe("Speed");
  expect(await rows("speed")).toEqual(["✓ Default speed", "Fast"]);
  // The toolbar button keeps its desktop name; only its menu is titled by the page.
  expect((await control("model"))?.label).toBe("Agent and model");
  expect((await control("options"))?.title).toBe("Options");
  const initial = [
    "Thinking effort: Medium",
    "Permission mode: Default permissions",
    "Speed: Default",
    "Plan mode: off",
  ];
  await expect.poll(options).toEqual(initial);

  await event(page, "composer", "", { kind: "press", control: "options", value: "plan" });
  await expect.poll(options).toEqual([...initial.slice(0, 3), "Plan mode: on"]);
  await event(page, "composer", "", { kind: "press", control: "options", value: "plan" });
  await expect.poll(options).toEqual(initial);
  await event(page, "composer", "", { kind: "press", control: "speed", value: "speed:fast" });
  await expect.poll(options).toEqual([initial[0], initial[1], "Speed: Fast", initial[3]]);
  await event(page, "composer", "", { kind: "press", control: "speed", value: "speed:" });
  await expect.poll(options).toEqual(initial);
  expect(errors).toEqual([]);
});
/** A microphone that hears silence, standing in for the one WebKit offers on iOS. */
async function fakeMicrophone(page: Page) {
  await page.addInitScript(() => {
    if (window.parent === window) return;
    const track = { stop: () => undefined };
    class FakeAudioContext {
      sampleRate = 16_000;
      state = "running";
      destination = {};
      resume = async () => undefined;
      close = async () => {
        this.state = "closed";
      };
      createMediaStreamSource = () => ({ connect: () => undefined });
      createGain = () => ({ gain: { value: 1 }, connect: () => undefined });
      createScriptProcessor = () => {
        const processor = {
          onaudioprocess: null as ((event: unknown) => void) | null,
          connect: () => undefined,
        };
        const timer = setInterval(() => {
          if (this.state === "closed") clearInterval(timer);
          else
            processor.onaudioprocess?.({
              inputBuffer: { getChannelData: () => new Float32Array(4096) },
            });
        }, 100);
        return processor;
      };
    }
    Object.defineProperty(window, "AudioContext", { value: FakeAudioContext });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    });
  });
}
test("the native microphone dictates through the machine and returns the words to the field", async ({
  page,
}) => {
  await fakeMicrophone(page);
  const ui = await openNativeDemo(page);
  await expect.poll(async () => (await composer(page))?.dictationHelp ?? null).toBeNull();
  // The native field's latest text is kept, even if its last keystroke has not arrived yet.
  await event(page, "composer", "composer", {
    kind: "press",
    control: "dictate",
    text: "Before:",
  });
  const recording = ui.getByRole("group", { name: "Dictation", exact: true });
  await expect(recording).toBeVisible();
  // The native field gets out of the way, and no second microphone stream is opened for a meter.
  await expect.poll(() => composer(page)).toBeNull();
  await expect(recording.getByRole("meter")).toHaveCount(0);
  await expect(
    recording.getByRole("button", { name: /^(Send|Queue) dictated message$/ }),
  ).toBeVisible();
  // With no waveform on a phone, the words so far show that it is hearing you.
  await expect(recording.getByText("This is a simulated dictation.")).toBeVisible();
  await recording.getByRole("button", { name: "Edit dictated message", exact: true }).click();
  await expect(recording).toHaveCount(0);
  await expect
    .poll(async () => (await composer(page))?.draft)
    .toBe("Before: This is a simulated dictation.");
});
test("the native microphone explains the keyboard where the webview offers no microphone", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.parent !== window)
      Object.defineProperty(navigator, "mediaDevices", { value: undefined });
  });
  const ui = await openNativeDemo(page);
  await expect
    .poll(async () => (await composer(page))?.dictationHelp)
    .toMatch(/microphone on your phone’s keyboard/);
  // Nothing starts even if a press arrives.
  await event(page, "composer", "composer", { kind: "press", control: "dictate", text: "" });
  await expect(ui.getByRole("group", { name: "Dictation", exact: true })).toHaveCount(0);
});
test("native surface bridge preserves navigation, drafts, settings, attachments and submission", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ui = await openNativeDemo(page);
  await expect(ui.locator("[data-agent-composer]")).toHaveCount(0);
  await expect(ui.getByRole("button", { name: "Open sidebar", exact: true })).toHaveCount(0);
  await expect(ui.getByLabel("Agent tasks", { exact: true })).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(ui.locator('[data-native-composer="true"]')).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  const initial = await snapshot(page);
  if (!initial) throw new Error("No native snapshot");
  expect(initial?.surfaces.filter((item) => item.content.kind === "button")).toHaveLength(3);
  await event(page, "button", "Open sidebar", { kind: "press", control: "activate" });
  const sidebarSurfaces = async () =>
    (await snapshot(page))?.surfaces
      .filter((item) => item.interactive !== false)
      .map((item) =>
        item.content.kind === "button" ? [item.content.label, item.content.icon] : "composer",
      );
  await expect.poll(sidebarSurfaces).toEqual([["Search workspace", "search"]]);
  // The translated workspace menu remains drawn beside Search, underneath its scrim.
  await expect
    .poll(async () =>
      (await snapshot(page))?.surfaces.some(
        (item) =>
          item.content.kind === "button" &&
          item.content.icon === "menu" &&
          item.interactive === false,
      ),
    )
    .toBe(true);
  const menu = initial.surfaces.find(
    (item) => item.content.kind === "button" && item.content.label === "Open sidebar",
  );
  const search = (await snapshot(page))?.surfaces.find(
    (item) => item.content.kind === "button" && item.content.label === "Search workspace",
  );
  expect(search?.frame.y).toBe(menu?.frame.y);
  expect(search?.frame.height).toBe(menu?.frame.height);
  await expect(ui.getByRole("button", { name: "Close sidebar", exact: true })).toHaveCount(0);
  await event(page, "button", "Search workspace", { kind: "press", control: "activate" });
  await expect(ui.getByPlaceholder("Search workspaces and tabs…")).toBeVisible();
  await expect.poll(async () => (await snapshot(page))?.surfaces).toEqual([]);
  await page.keyboard.press("Escape");
  await expect.poll(sidebarSurfaces).toEqual([["Search workspace", "search"]]);
  await ui.getByRole("button", { name: /^Account:/ }).click();
  const account = ui.getByRole("dialog", { name: "Account", exact: true });
  await expect(account).toBeVisible();
  await expect.poll(async () => (await snapshot(page))?.surfaces).toEqual([]);
  await account.press("Escape");
  await expect.poll(sidebarSurfaces).toEqual([["Search workspace", "search"]]);
  await ui.getByRole("button", { name: "Return to workspace", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot(page))?.surfaces.some((item) => item.content.kind === "composer"),
    )
    .toBe(true);
  // Sidebar surfaces follow the panel while it slides away, so Search leaves a moment later.
  await expect
    .poll(async () =>
      (await snapshot(page))?.surfaces.some(
        (item) => item.content.kind === "button" && item.content.label === "Search workspace",
      ),
    )
    .toBe(false);
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
  const typing = await snapshot(page);
  const field = typing?.surfaces.find((item) => item.content.kind === "composer");
  const typingFrame = page.frames().find((item) => item !== page.mainFrame());
  if (!typing || !field || !typingFrame) throw new Error("Missing native composer");
  await typingFrame.evaluate(
    (messages) => {
      for (const message of messages) (window as TestWindow).concorsMobileReceive?.(message);
    },
    [
      {
        type: "native-event",
        scope: typing.scope,
        connectionId: typing.connectionId,
        surfaceId: field.id,
        event: { kind: "text", text: "Native draft survives navigation", sequence: 3 },
      },
      {
        type: "native-event",
        scope: typing.scope,
        connectionId: typing.connectionId,
        surfaceId: field.id,
        event: { kind: "text", text: "Stale keystroke must not win", sequence: 2 },
      },
    ] satisfies MobileHostMessage[],
  );
  await expect
    .poll(async () => {
      const content = (await snapshot(page))?.surfaces.find(
        (item) => item.content.kind === "composer",
      )?.content;
      return content?.kind === "composer" ? [content.draft, content.editAck] : null;
    })
    .toEqual(["Native draft survives navigation", 3]);
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
  await event(page, "button", "Workspace", { kind: "press", control: "activate" });
  await expect(ui.getByRole("dialog", { name: "Workspaces", exact: true })).toBeVisible();
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
    .getByRole("dialog", { name: "Workspaces", exact: true })
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
  // The native Send button stays disabled while the approval is being answered.
  await expect
    .poll(async () => {
      const content = (await snapshot(page))?.surfaces.find(
        (item) => item.content.kind === "composer",
      )?.content;
      return content?.kind === "composer" && content.canSend;
    })
    .toBe(true);
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

test("the native context sheet reads plan usage when it opens", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openNativeDemo(page);
  // The composer carries the context window from the start; plan usage waits for the sheet.
  expect((await composer(page))?.usage).toEqual({
    context: {
      summary: "12k / 200k tokens, 6% used",
      detail: "18k cumulative tokens",
      percent: 6.2,
      tone: "ok",
    },
    plan: {
      label: null,
      loading: false,
      error: null,
      message: "Reading plan usage…",
      windows: [],
    },
  });
  await event(page, "composer", "", { kind: "press", control: "context" });
  await expect
    .poll(async () => (await composer(page))?.usage?.plan)
    .toMatchObject({
      label: "Pro",
      loading: false,
      message: null,
      windows: [
        {
          label: "Session",
          percent: 28,
          tone: "ok",
          summary: expect.stringMatching(/^28%, resets in (3h|2h 59m)$/),
        },
        { label: "Weekly", percent: 74, tone: "warning" },
      ],
    });
  expect(errors).toEqual([]);
});
