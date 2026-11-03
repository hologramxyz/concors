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

test("the Fast chip names itself, lights up when on and has no search in its menu", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-fast-chip-"));
  let fast = false;
  await rewriteAgents(page, (agent) => {
    agent["controls"] = {
      ...(agent["controls"] as object),
      features: [{ id: "fast_mode", label: "Fast mode", description: "Faster", value: fast }],
    };
  });
  try {
    await openChat(page, "Fast chip", directory);
    const chip = page.getByRole("button", { name: "Fast mode", exact: true });
    await expect(chip).toHaveText("Fast");
    await expect(chip).not.toHaveClass(/text-primary/);
    await shots(page, "fast-off");
    await chip.click();
    const menu = page.getByRole("listbox", { name: "Fast mode" });
    await expect(menu.getByRole("option")).toHaveText(["On", "Off"]);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    // The list takes focus in place of the search box, so the keys still work.
    await expect(menu).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu).toHaveAttribute("aria-activedescendant", /-1$/);
    await shots(page, "fast-menu");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    fast = true;
    await page.reload();
    await expect(chip).toHaveClass(/text-primary/);
    await expect(chip).toHaveText("Fast");
    await page.mouse.move(700, 300);
    await shots(page, "fast-on");
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
