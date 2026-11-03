import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";
import { test, expect, signedIn } from "./signed-in.ts";
import { chooseProvider } from "./support/agents.ts";
import { seedProject } from "./support/projects.ts";

/** Shows the same state in both themes. */
async function shots(page: Page, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Past the colours' transition and whatever just opened or folded.
    await page.waitForTimeout(500);
    await page.screenshot({ path: test.info().outputPath(`${name}-${colorScheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** Rewrites what the daemon says about a chat, for what the test provider does not report. */
async function rewriteAgents(page: Page, rewrite: (agent: Record<string, unknown>) => void) {
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => server.send(raw));
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw), (_key, value) => {
        if (value && typeof value === "object" && "threadId" in value && "provider" in value)
          rewrite(value as Record<string, unknown>);
        return value;
      });
      socket.send(JSON.stringify(message));
    });
  });
}

async function openChat(page: Page, name: string, directory: string) {
  await signedIn(page);
  await page.goto("/");
  await seedProject(page, name, directory);
  await page.getByRole("button", { name: "New tab options", exact: true }).click();
  await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
  await chooseProvider(page);
  await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
}

test("Fast mode is one switch with its icon and name", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-fast-chip-"));
  const sent: boolean[] = [];
  let fast = false;
  // The test provider has no Fast mode, so the daemon would refuse it: the spec plays that part.
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw), (_key, value) => {
        if (value?.kind === "configure" && value.settings?.features) {
          fast = value.settings.features.fast_mode === true;
          sent.push(fast);
          value.settings.features = {};
        }
        return value;
      });
      server.send(JSON.stringify(message));
    });
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw), (_key, value) => {
        // Claude has no separate Speed chip, and the toolbar has to fit what it does show.
        if (value && typeof value === "object" && "serviceTiers" in value)
          delete value.serviceTiers;
        if (value && typeof value === "object" && "threadId" in value && "provider" in value) {
          value.controls = {
            ...value.controls,
            features: [{ id: "fast_mode", label: "Fast mode", description: "Faster", value: fast }],
          };
          value.settings = { ...value.settings, features: { fast_mode: fast } };
        }
        return value;
      });
      socket.send(JSON.stringify(message));
    });
  });
  try {
    await openChat(page, "Fast chip", directory);
    const chip = page.getByRole("switch", { name: "Fast mode", exact: true });
    const track = chip.locator("[data-switch-track]");
    const knob = chip.locator("[data-switch-knob]");
    const tooltip = page.getByRole("tooltip");
    const away = async () => {
      await page.mouse.move(700, 300);
      await expect(tooltip).toHaveCount(0);
      await page.waitForTimeout(300);
    };
    const look = () =>
      chip.evaluate((node) => {
        const track = node.querySelector("[data-switch-track]") as Element;
        return {
          chip: getComputedStyle(node).backgroundColor,
          color: getComputedStyle(node).color,
          track: getComputedStyle(track).backgroundColor,
        };
      });
    const knobOffset = async () => {
      await page.waitForTimeout(300);
      const [outer, inner] = await Promise.all([track.boundingBox(), knob.boundingBox()]);
      if (!outer || !inner) throw new Error("The switch has no box");
      return inner.x - outer.x;
    };

    await expect(chip).toHaveText("Fast");
    await expect(chip).toHaveAttribute("aria-checked", "false");
    const size = await track.boundingBox();
    expect([size?.width, size?.height]).toEqual([26, 16]);
    const height = await chip.evaluate((node) => node.getBoundingClientRect().height);
    expect(height).toBe(
      await page
        .getByRole("button", { name: "Attach files", exact: true })
        .evaluate((node) => node.getBoundingClientRect().height),
    );
    await away();
    const off = await look();
    expect(await knobOffset()).toBe(2);
    await shots(page, "fast-off");

    await chip.hover();
    await expect(tooltip).toHaveText("Fast mode");
    await page.waitForTimeout(300);
    const offHover = await look();
    expect(offHover.chip).not.toBe(off.chip);
    await shots(page, "fast-off-hover");

    // The label, the icon and the switch each toggle it, and no menu opens.
    await chip.getByText("Fast", { exact: true }).click();
    await expect(chip).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(chip).toBeEnabled();
    await chip.locator("svg").first().click();
    await expect(chip).toHaveAttribute("aria-checked", "false");
    await expect(chip).toBeEnabled();
    await track.click();
    await expect(chip).toHaveAttribute("aria-checked", "true");
    await expect(chip).toBeEnabled();
    expect(sent).toEqual([true, false, true]);

    // Only the switch shows the state; the chip itself looks the same either way.
    await away();
    const on = await look();
    expect(on.chip).toBe(off.chip);
    expect(on.color).toBe(off.color);
    expect(on.track).not.toBe(off.track);
    expect(await knobOffset()).toBe(12);
    await shots(page, "fast-on");
    await chip.hover();
    await expect(tooltip).toHaveText("Fast mode");
    await page.waitForTimeout(300);
    expect(await look()).toEqual({ ...offHover, track: on.track });
    await shots(page, "fast-on-hover");
    await away();

    // Space and Enter both switch it and leave focus on it, ready for the next press.
    await chip.focus();
    await page.keyboard.press("Space");
    await expect(chip).toHaveAttribute("aria-checked", "false");
    await expect(chip).toBeEnabled();
    await expect(chip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(chip).toHaveAttribute("aria-checked", "true");
    await expect(chip).toBeEnabled();
    await expect(chip).toBeFocused();
    expect(await chip.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
    await shots(page, "fast-on-focus");
    await chip.blur();

    // In narrow panes the word gives way, and the switch stays.
    const toolbar = page.locator(".agent-composer-toolbar");
    for (const width of [900, 760, 640, 560]) {
      await page.setViewportSize({ width, height: 850 });
      await expect
        .poll(
          () =>
            toolbar.evaluate((row) => {
              const edge = row.getBoundingClientRect().right;
              return [...row.querySelectorAll("button")].some(
                (button) => button.getBoundingClientRect().right > edge + 0.5,
              );
            }),
          { message: `${width}px` },
        )
        .toBe(false);
      await expect(track).toBeVisible();
    }
    await expect(chip.getByText("Fast", { exact: true })).toBeHidden();
    await shots(page, "fast-narrow-on");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-checked", "false");
    await page.mouse.move(100, 400);
    await shots(page, "fast-narrow-off");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("every tooltip is the same box, waits as long and sits as close", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-tooltip-box-"));
  try {
    await openChat(page, "Tooltip box", directory);
    const box = page.locator('[data-slot="tooltip-content"]');
    const measured: { look: string; gap: number; name: string }[] = [];
    const controls = [
      ["Composer chip", page.getByRole("button", { name: "Attach files", exact: true }), "top"],
      ["Title bar", page.getByRole("button", { name: "Search", exact: true }).first(), "bottom"],
      ["Tab bar", page.getByRole("button", { name: "New tab", exact: true }), "bottom"],
    ] as const;
    for (const [name, control, side] of controls) {
      await page.mouse.move(700, 300);
      await expect(box).toHaveCount(0);
      // Past the moment moving along a row shows the next one at once.
      await page.waitForTimeout(400);
      await control.hover();
      await page.waitForTimeout(400);
      await expect(box).toHaveCount(0);
      await expect(box).toBeVisible();
      // Past its opening animation, which scales the box.
      await page.waitForTimeout(300);
      await expect(box.locator("polygon")).toHaveCount(0);
      const tip = await box.boundingBox();
      const target = await control.boundingBox();
      if (!tip || !target) throw new Error(`${name} has no box`);
      const gap =
        side === "top" ? target.y - (tip.y + tip.height) : tip.y - (target.y + target.height);
      const look = await box.evaluate((node) => {
        const style = getComputedStyle(node);
        return [
          style.backgroundColor,
          style.borderRadius,
          // Not the right padding, which tightens around key chips.
          style.paddingTop,
          style.paddingLeft,
          style.fontSize,
          style.backdropFilter,
          style.boxShadow,
        ].join("|");
      });
      measured.push({ name, gap, look });
      await shots(page, `tooltip-${name.toLowerCase().replace(" ", "-")}`);
    }
    for (const { name, gap } of measured) {
      expect(gap, name).toBeGreaterThanOrEqual(4);
      expect(gap, name).toBeLessThanOrEqual(6);
    }
    const gaps = measured.map(({ gap }) => gap);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
    expect(new Set(measured.map(({ look }) => look)).size).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tooltips come from hover and Tab only, and follow the pointer along a row", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-tooltips-"));
  try {
    await openChat(page, "Tooltips", directory);
    const tooltip = page.getByRole("tooltip");
    const attach = page.getByRole("button", { name: "Attach files", exact: true });
    const picker = page.getByRole("button", { name: "Agent and model", exact: true });

    // Along a row: the old one closes and the new one opens, with no gap to wait out.
    await attach.hover();
    await expect(tooltip).toContainText("Attach files");
    await picker.hover();
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toContainText("Agent and model");
    await expect(tooltip).not.toContainText("Attach files");
    await shots(page, "tooltip-next-control");

    // A composer menu closing by key hands focus back without bringing up the tooltip.
    await page.mouse.move(700, 300);
    await expect(tooltip).toHaveCount(0);
    await picker.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(picker).toBeFocused();
    await page.waitForTimeout(500);
    await expect(tooltip).toHaveCount(0);

    // So does a sidebar menu, closed by a key or by a click elsewhere.
    const plus = page.getByRole("button", { name: "Open workspace menu", exact: true });
    await plus.click();
    await page.mouse.move(700, 300);
    await page.keyboard.press("Escape");
    await expect(plus).toBeFocused();
    await page.waitForTimeout(800);
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(700, 300);
    await shots(page, "tooltip-after-menu");

    // Tabbing onto a control still explains it, and hovering still does.
    await plus.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(plus).toBeFocused();
    await expect(tooltip).toContainText("New workspace or open folder");
    await shots(page, "tooltip-tab-focus");
    await page.keyboard.press("Escape");
    await page.mouse.move(700, 300);
    await plus.hover();
    await expect(tooltip).toContainText("New workspace or open folder");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the model menu lists current models, then older ones below a divider", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-model-order-"));
  const ids = [
    ["claude-opus-5-5", "Opus 5.5"],
    ["claude-sonnet-5-5", "Sonnet 5.5"],
    ["claude-sonnet-4-6", "Sonnet 4.6"],
    ["claude-opus-4-6", "Opus 4.6"],
    ["claude-opus-5", "Opus 5"],
  ];
  await rewriteAgents(page, (agent) => {
    agent["model"] = "claude-opus-5-5";
    agent["models"] = ids.map(([id, label]) => ({
      id,
      label,
      resolvedModel: id,
      efforts: [],
      defaultEffort: null,
    }));
  });
  try {
    await openChat(page, "Model order", directory);
    await page.getByRole("button", { name: "Agent and model", exact: true }).click();
    const list = page.getByRole("listbox", { name: "Models" });
    await expect(list.getByRole("option")).toHaveText([
      "Opus 5.5",
      "Sonnet 5.5",
      "Opus 5",
      "Opus 4.6",
      "Sonnet 4.6",
    ]);
    const divider = list.locator("[data-older-models]");
    await expect(divider).toHaveCount(1);
    await expect(divider.locator("+ button")).toHaveText("Opus 5");
    await shots(page, "model-menu");
    // A search that leaves only one group has nothing to divide.
    await page.getByRole("combobox", { name: "Search models" }).fill("5.5");
    await expect(divider).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("each workspace folds on its own, from a chevron or its name, across restarts", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const first = await mkdtemp(join(tmpdir(), "concors-fold-first-"));
  const second = await mkdtemp(join(tmpdir(), "concors-fold-second-"));
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "folding", version: "0.0.0" },
  });
  control.subscribeWorkspace(() => undefined);
  try {
    await control.connect();
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Fold first", first);
    await seedProject(page, "Fold second", second);
    const name = (label: string) => page.getByRole("button", { name: label, exact: true });
    const list = (label: string) => page.getByRole("list", { name: `${label} tabs` });
    const row = (label: string) => page.locator("li").filter({ has: name(label) });
    const toggle = (label: string) => row(label).locator("[data-workspace-toggle]");
    const current = (label: string) => expect(name(label)).toHaveAttribute("aria-current", "page");

    // Both start expanded, whichever you are in.
    await name("Fold first").click();
    await current("Fold first");
    await name("Fold second").click();
    await current("Fold second");
    await expect(list("Fold first")).toBeVisible();
    await expect(list("Fold second")).toBeVisible();

    // The chevron replaces the icon in the same place, moving nothing.
    await page.mouse.move(700, 300);
    const icon = row("Fold first").locator("[data-project-icon]");
    await expect(toggle("Fold first")).toHaveCSS("opacity", "0");
    const before = await name("Fold first").boundingBox();
    const iconBox = await icon.boundingBox();
    await row("Fold first").hover();
    await expect(toggle("Fold first")).toHaveCSS("opacity", "1");
    await expect(icon.locator("xpath=..")).toHaveCSS("opacity", "0");
    expect(await name("Fold first").boundingBox()).toEqual(before);
    const glyph = await toggle("Fold first").locator("svg").boundingBox();
    expect(glyph && iconBox && Math.abs(glyph.x + 8 - (iconBox.x + 10))).toBeLessThanOrEqual(1);
    expect(glyph && iconBox && Math.abs(glyph.y + 8 - (iconBox.y + 10))).toBeLessThanOrEqual(1);
    await expect(toggle("Fold first")).toHaveAttribute("aria-label", "Collapse Fold first");
    await shots(page, "workspace-chevron-expanded");

    // Clicking it folds only that one, and does not switch to it.
    await toggle("Fold first").click();
    await expect(list("Fold first").locator("xpath=ancestor::li[1]")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    await expect(list("Fold second")).toBeVisible();
    await current("Fold second");
    await expect(toggle("Fold first")).toHaveAttribute("aria-label", "Expand Fold first");
    await shots(page, "workspace-chevron-collapsed");

    // Remembered across a restart.
    await page.reload();
    await expect(name("Fold first")).toBeVisible();
    await expect(toggle("Fold first")).toHaveAttribute("aria-expanded", "false");
    await expect(toggle("Fold second")).toHaveAttribute("aria-expanded", "true");

    // Expanding one leaves the others as they were.
    await toggle("Fold second").click({ force: true });
    await expect(toggle("Fold second")).toHaveAttribute("aria-expanded", "false");
    await toggle("Fold first").click({ force: true });
    await expect(toggle("Fold first")).toHaveAttribute("aria-expanded", "true");
    await expect(toggle("Fold second")).toHaveAttribute("aria-expanded", "false");
    await toggle("Fold first").click({ force: true });

    // Its name switches to it and expands it; again collapses it, and again expands it.
    await name("Fold first").click();
    await current("Fold first");
    await expect(toggle("Fold first")).toHaveAttribute("aria-expanded", "true");
    await expect(toggle("Fold second")).toHaveAttribute("aria-expanded", "false");
    await name("Fold first").click();
    await expect(toggle("Fold first")).toHaveAttribute("aria-expanded", "false");
    await current("Fold first");
    await name("Fold first").click();
    await expect(toggle("Fold first")).toHaveAttribute("aria-expanded", "true");

    // The keyboard reaches it, and focus reveals it.
    await name("Fold first").focus();
    await page.keyboard.press("Shift+Tab");
    await expect(toggle("Fold first")).toBeFocused();
    await expect(toggle("Fold first")).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect(toggle("Fold first")).toHaveAttribute("aria-expanded", "false");
    await shots(page, "workspace-chevron-focus");
  } finally {
    control.disconnect();
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test("the attention dot stays over the chevron, only while collapsed", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-fold-dot-"));
  const other = await mkdtemp(join(tmpdir(), "concors-fold-dot-other-"));
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "dot", version: "0.0.0" },
  });
  control.subscribeWorkspace(() => undefined);
  try {
    await control.connect();
    await openChat(page, "Fold dot", directory);
    await expect.poll(() => control.agents.find((a) => a.directory === directory)?.id).toBeTruthy();
    const id = control.agents.find((a) => a.directory === directory)?.id ?? "";
    // Seen from another workspace, so it stays unread.
    await seedProject(page, "Fold dot other", other);
    await page.getByRole("button", { name: "Fold dot other", exact: true }).click();
    await control.requestAgent({ kind: "send", sessionId: id, text: "hello" }, crypto.randomUUID());
    await expect.poll(() => control.agents.find((a) => a.id === id)?.status).toBe("done");

    const name = page.getByRole("button", { name: /^Fold dot(,|$)/ });
    const row = page.locator("li").filter({ has: name });
    const dot = row.locator("[data-workspace-attention]");
    const toggle = row.locator("[data-workspace-toggle]");
    await expect(dot).toHaveCount(0);
    await row.hover();
    await toggle.click();
    await expect(dot).toBeVisible();
    await expect(toggle).toHaveCSS("opacity", "1");
    // The dot is painted above the chevron, yet the chevron still takes the click.
    const box = await dot.boundingBox();
    expect(
      box &&
        (await page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest("[data-workspace-toggle]") !== null,
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        )),
    ).toBe(true);
    await shots(page, "workspace-dot-over-chevron");
    await toggle.click();
    await expect(dot).toHaveCount(0);
  } finally {
    control.disconnect();
    await rm(directory, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});

test("Recently closed heads the closed workspaces, and only when there are some", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-recently-closed-"));
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "closed", version: "0.0.0" },
  });
  control.subscribeWorkspace(() => undefined);
  try {
    await control.connect();
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Soon closed", directory);
    const plus = page.getByRole("button", { name: "Open workspace menu", exact: true });
    const heading = page.getByText("Recently closed", { exact: true });
    await expect.poll(() => control.workspace?.projects.length).toBeGreaterThan(0);
    const reopenable = control.workspace?.closedProjects?.length ?? 0;
    await plus.click();
    await expect(heading).toHaveCount(reopenable ? 1 : 0);
    await page.keyboard.press("Escape");

    const row = page
      .locator("li")
      .filter({ has: page.getByRole("button", { name: "Soon closed", exact: true }) });
    await row.hover();
    await row.getByRole("button", { name: "Actions for Soon closed", exact: true }).click();
    await page.getByRole("menuitem", { name: "Close workspace…" }).click();
    await page.getByRole("button", { name: "Close workspace", exact: true }).click();
    await expect(page.getByRole("button", { name: "Soon closed", exact: true })).toHaveCount(0);

    await plus.click();
    await expect(heading).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Soon closed" })).toBeVisible();
    await shots(page, "recently-closed");
  } finally {
    control.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Your messages opens beside its button, with a tooltip and no subtitle", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-your-messages-"));
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "messages", version: "0.0.0" },
  });
  control.subscribeWorkspace(() => undefined);
  try {
    await control.connect();
    await openChat(page, "Your messages", directory);
    await expect.poll(() => control.agents.find((a) => a.directory === directory)?.id).toBeTruthy();
    const id = control.agents.find((a) => a.directory === directory)?.id ?? "";
    for (const text of ["First request", "Second request"]) {
      await control.requestAgent({ kind: "send", sessionId: id, text }, crypto.randomUUID());
      await expect.poll(() => control.agents.find((a) => a.id === id)?.status).toBe("done");
    }
    await page.setViewportSize({ width: 560, height: 700 });
    const trigger = page.getByRole("button", { name: "Browse your messages", exact: true });
    await trigger.hover();
    await expect(page.getByRole("tooltip")).toContainText("Your messages");
    await expect(trigger).not.toHaveAttribute("title");
    await shots(page, "your-messages-tooltip");
    await trigger.click();
    const popover = page.getByRole("dialog", { name: "Your messages", exact: true });
    await expect(popover).toBeVisible();
    await expect(popover).not.toContainText("Jump to a message");
    await expect(popover.getByRole("button", { name: /Second request/ })).toBeVisible();
    // Nothing dims the app, as a dialog would.
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
    // Under the button and level with its right edge, once it has been placed.
    const button = await trigger.boundingBox();
    if (!button) throw new Error("The button has no box");
    await expect
      .poll(async () => {
        const box = await popover.boundingBox();
        return (
          box && [
            box.y >= button.y + button.height,
            Math.abs(box.x + box.width - button.x - button.width) <= 1,
          ]
        );
      })
      .toEqual([true, true]);
    expect((await popover.boundingBox())?.width).toBeLessThanOrEqual(288);
    await shots(page, "your-messages-popover");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.mouse.move(100, 500);
    await page.waitForTimeout(400);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  } finally {
    control.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});

test("shortcut panels are titled Tab and Pane", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-shortcut-titles-"));
  try {
    await openChat(page, "Shortcut titles", directory);
    await page.locator("body").click({ position: { x: 700, y: 20 } });
    await page.keyboard.press("Control+Shift+t");
    const tab = page.getByRole("dialog", { name: "Tab", exact: true });
    await expect(tab.locator('[data-slot="dialog-description"] kbd')).toBeVisible();
    await shots(page, "shortcut-tab");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Shift+p");
    await expect(page.getByRole("dialog", { name: "Pane", exact: true })).toBeVisible();
    await shots(page, "shortcut-pane");
    await page.keyboard.press("Escape");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a tooltip closes when the pointer reaches a control without one, even with no leave event", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-tooltip-leave-"));
  try {
    await openChat(page, "Tooltip leave", directory);
    const tooltip = page.getByRole("tooltip");
    const close = page.getByRole("button", { name: "Close pane", exact: true }).first();
    const options = page.getByRole("button", { name: "Pane actions", exact: true }).first();
    const files = page.getByRole("button", { name: "Toggle project files", exact: true });

    await options.hover();
    await expect(tooltip).toContainText("Pane options");
    await options.click();
    await expect(page.getByRole("menuitem", { name: "Rename pane" })).toBeVisible();
    await expect(tooltip).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.mouse.move(0, 0);

    await files.hover();
    await expect(tooltip).toContainText("Files");
    await expect(tooltip).not.toContainText("Project");
    await page.mouse.move(0, 0);
    await expect(tooltip).toHaveCount(0);

    // The Mac app's web view can lose the event for leaving a control, so it is held back here.
    await page.evaluate(() => {
      for (const type of ["pointerout", "pointerleave", "mouseout", "mouseleave"])
        window.addEventListener(
          type,
          (event) => {
            if (event.isTrusted) event.stopImmediatePropagation();
          },
          true,
        );
    });
    const neighbour = await page
      .locator("header")
      .filter({ has: close })
      .first()
      .evaluate((header) => {
        const span = document.createElement("button");
        span.setAttribute("data-no-tooltip", "");
        span.textContent = "x";
        header.append(span);
        return true;
      });
    expect(neighbour).toBe(true);
    await close.hover();
    await expect(tooltip).toContainText("Close pane");
    await page.locator("[data-no-tooltip]").hover();
    await expect(tooltip).toHaveCount(0);
    // And it can open again when the pointer comes back.
    await close.hover();
    await expect(tooltip).toContainText("Close pane");
    await page.locator("[data-no-tooltip]").hover();
    await expect(tooltip).toHaveCount(0);

    // A tooltip reached with Tab stays while the mouse moves elsewhere.
    await options.focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await expect(tooltip).toContainText("Close pane");
    await page.mouse.move(5, 5);
    await page.mouse.move(40, 40);
    await expect(tooltip).toContainText("Close pane");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a button shows a focus ring for the keyboard, not after the mouse", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-focus-ring-"));
  try {
    await openChat(page, "Focus ring", directory);
    const options = page.getByRole("button", { name: "Pane actions", exact: true }).first();
    const ring = () =>
      options.evaluate((node) => {
        const style = getComputedStyle(node);
        return node === document.activeElement && style.outlineStyle !== "none";
      });
    // Choosing nothing from a menu with the mouse hands focus back to its trigger.
    await options.click();
    await page.getByRole("menuitem").first().hover();
    await page.mouse.click(600, 500);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await options.focus();
    await expect.poll(ring).toBe(false);
    await expect(options).toHaveAttribute("data-pointer-focus");
    // Any key brings it back, for someone who carries on from the keyboard.
    await page.keyboard.press("ArrowLeft");
    await expect(options).not.toHaveAttribute("data-pointer-focus");
    await expect.poll(ring).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
