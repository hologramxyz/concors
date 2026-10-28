import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";
import { mockDictation } from "./support/dictation.ts";
import { tab } from "./support/tabs.ts";

async function workspace(page: Page) {
  const directory = await mkdtemp(join(tmpdir(), "concors-agent-keyboard-"));
  await signedIn(page);
  await mockDictation(page);
  await page.goto("/");
  await seedProject(page, "Agent keyboard", directory);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
  await chooseProvider(page);
  const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
  await expect(composer).toBeFocused();
  return { composer, dispose: () => rm(directory, { recursive: true, force: true }) };
}

test("reverse native tab switching preserves permission mode and focuses the destination input", async ({
  page,
}) => {
  const { composer, dispose } = await workspace(page);
  try {
    const permissions = page.getByRole("button", { name: "Permission mode", exact: true });
    // Shift+Tab changes the mode only once the chat's controls are ready; before, it is ignored.
    await expect(permissions).toBeEnabled();
    await expect(permissions).toHaveAttribute("data-value", "default");
    // The browser leaves Ctrl+Shift+Tab to its host; it must never change agent permissions.
    await composer.press("Control+Shift+Tab");
    await expect(permissions).toHaveAttribute("data-value", "default");
    await composer.press("Shift+Tab");
    await expect(permissions).toHaveAttribute("data-value", "auto-review");
    await expect(composer).toBeFocused();
    await composer.press("Shift+Tab");
    await expect(permissions).toHaveAttribute("data-value", "full-access");
    await composer.press("Shift+Tab");
    await expect(permissions).toHaveAttribute("data-value", "default");
    await composer.press("Shift+Tab");
    await expect(permissions).toHaveAttribute("data-value", "auto-review");
    await expect(composer).toBeEnabled();
    await composer.fill("Keep my draft");
    // Select only the shortcut dispatcher's native branch; this page keeps its browser runtime.
    await page.evaluate(() => Object.assign(window, { isTauri: true }));
    await composer.press("Control+Shift+Tab");
    await expect(tab(page, 0)).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator(".concors-terminal textarea").filter({ visible: true }),
    ).toBeFocused();
    await page.keyboard.press("Control+Tab");
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("Keep my draft");
    await expect(permissions).toHaveAttribute("data-value", "auto-review");
    await page.keyboard.press("Control+Tab");
    await expect(
      page.locator(".concors-terminal textarea").filter({ visible: true }),
    ).toBeFocused();
    await page.keyboard.press("Control+Shift+Tab");
    await expect(composer).toBeFocused();
    await expect(permissions).toHaveAttribute("data-value", "auto-review");
  } finally {
    await dispose();
  }
});

test("composer tooltips share Plan mode styling and show the available shortcuts", async ({
  page,
}) => {
  const { composer, dispose } = await workspace(page);
  try {
    const tooltip = page.getByRole("tooltip");
    const hover = async (name: string, text: RegExp, shortcut?: string) => {
      await page.mouse.move(0, 0, { steps: 5 });
      await expect(tooltip).toHaveCount(0);
      const button = page.getByRole("button", { name, exact: true });
      await button.hover();
      await expect(tooltip).toContainText(text);
      await expect(button).not.toHaveAttribute("title");
      if (shortcut) await expect(tooltip.locator("kbd")).toHaveText(shortcut);
      else await expect(tooltip.locator("kbd")).toHaveCount(0);
      return tooltip.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.backgroundColor, style.color, style.borderRadius, style.fontSize];
      });
    };
    const planStyle = await hover("Plan mode", /^Plan mode: explore and plan/);
    for (const [name, text, shortcut] of [
      ["Attach files", /^Attach files/, undefined],
      ["Agent and model", /^Agent and model: /, undefined],
      ["Thinking effort", /^Thinking effort: /, undefined],
      ["Permission mode", /^Permission mode: Default permissions/, "Shift+Tab"],
      ["Speed", /^Speed: /, undefined],
      ["Start dictation", /^Dictate a message/, "Ctrl+D"],
      ["Send message", /^Send message/, "Enter"],
    ] as const) {
      expect(await hover(name, text, shortcut)).toEqual(planStyle);
    }
    await hover("Permission mode", /^Permission mode: Default permissions/, "Shift+Tab");
    await page.screenshot({ path: test.info().outputPath("composer-permission-tooltip.png") });
    await composer.fill("hold tooltip turn");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    expect(await hover("Interrupt agent", /^Stop agent/, "Esc")).toEqual(planStyle);
    expect(await hover("Queue message", /^Queue message/, "Enter")).toEqual(planStyle);
    await composer.press("Control+d");
    await expect(page.getByRole("group", { name: "Dictation" })).toBeFocused();
    await hover("Cancel dictation", /^Cancel dictation/, "Esc");
    await hover("Edit dictated message", /^Edit dictated message/);
    await hover("Queue dictated message", /^Queue message/, "Enter");
    await page.keyboard.press("Escape");
    await expect(composer).toBeFocused();
    await page.evaluate(() => {
      const key = "concors.shortcuts.v1";
      localStorage.setItem(key, JSON.stringify({ "start-dictation": [] }));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    await page.mouse.move(0, 0, { steps: 5 });
    await page.getByRole("button", { name: "Start dictation", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toContainText("Dictate a message");
    await expect(page.getByRole("tooltip").locator("kbd")).toHaveCount(0);
  } finally {
    await dispose();
  }
});

test("the dictation tooltip reflects a customized keyboard shortcut", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "concors.shortcuts.v1",
      JSON.stringify({
        "start-dictation": [{ keys: [{ key: "d", modifiers: ["Control", "Alt"] }] }],
      }),
    );
  });
  const { composer, dispose } = await workspace(page);
  try {
    await page.getByRole("button", { name: "Start dictation", exact: true }).hover();
    await expect(page.getByRole("tooltip").locator("kbd")).toHaveText("Ctrl+Alt+D");
    await composer.press("Control+Alt+d");
    await expect(page.getByRole("group", { name: "Dictation" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(composer).toBeFocused();
  } finally {
    await dispose();
  }
});

test("Ctrl+D dictates in the focused agent pane, preserves drafts, and remains terminal EOF", async ({
  page,
}) => {
  const { composer, dispose } = await workspace(page);
  try {
    await composer.fill("Left draft");
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("Enter");
    await chooseProvider(page);
    const panes = page.getByRole("region", { name: "Agent pane", exact: true });
    const inputs = panes.getByRole("textbox", { name: "Message Codex", exact: true });
    await expect(inputs).toHaveCount(2);
    await inputs.last().fill("Right draft");
    await page.keyboard.press("Control+Shift+ArrowLeft");
    await expect(inputs.first()).toBeFocused();
    await page.keyboard.press("Control+d");
    const recording = panes.first().getByRole("group", { name: "Dictation", exact: true });
    await expect(recording).toBeFocused();
    await expect(panes.last().getByRole("group", { name: "Dictation" })).toHaveCount(0);
    await page.keyboard.press("Control+d");
    await page.evaluate(() => window.testDictation.result("Dictated words", true));
    await page.keyboard.press("Escape");
    await expect(inputs.first()).toBeFocused();
    await expect(inputs.first()).toHaveValue("Left draft");
    await expect(inputs.last()).toHaveValue("Right draft");
    await expect.poll(() => page.evaluate(() => window.testDictation.capture.tracks)).toBe(0);
    await page.keyboard.press("Control+Shift+ArrowRight");
    await page.keyboard.press("Control+d");
    await expect(panes.last().getByRole("group", { name: "Dictation" })).toBeFocused();
    await page.evaluate(() => window.testDictation.result("more words", true));
    await page.getByRole("button", { name: "Edit dictated message", exact: true }).click();
    await page.evaluate(() => window.testDictation.end());
    await expect(inputs.last()).toBeFocused();
    await expect(inputs.last()).toHaveValue("Right draft more words");
    await expect(page.getByRole("log").getByText("Right draft more words")).toHaveCount(0);
    await tab(page, 0).click();
    const terminal = page.locator(".concors-terminal textarea").filter({ visible: true });
    await expect(terminal).toBeFocused();
    await page.keyboard.press("Control+d");
    await expect(page.getByRole("button", { name: "Start new session" })).toBeVisible();
  } finally {
    await dispose();
  }
});

test("Escape stops only the focused running agent, including from its header or during dictation", async ({
  page,
}) => {
  const { composer, dispose } = await workspace(page);
  try {
    await composer.fill("hold left turn");
    await composer.press("Enter");
    const panes = page.getByRole("region", { name: "Agent pane", exact: true });
    await expect(panes.first().getByRole("button", { name: "Interrupt agent" })).toBeEnabled();
    await composer.fill("Unsent left draft");
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("Escape");
    await expect(composer).toBeFocused();
    await expect(panes.first().getByRole("button", { name: "Interrupt agent" })).toBeEnabled();
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("Enter");
    await chooseProvider(page);
    const inputs = panes.getByRole("textbox", { name: "Message Codex", exact: true });
    await expect(inputs).toHaveCount(2);
    await inputs.last().fill("hold right turn");
    await inputs.last().press("Enter");
    await expect(panes.last().getByRole("button", { name: "Interrupt agent" })).toBeEnabled();
    await inputs.last().fill("Unsent right draft");
    await page.keyboard.press("Control+d");
    await expect(panes.last().getByRole("group", { name: "Dictation" })).toBeFocused();
    await page.evaluate(() => window.testDictation.result("Do not send this", true));
    await page.keyboard.press("Escape");
    await expect(panes.last().getByRole("button", { name: "Interrupt agent" })).toHaveCount(0);
    await expect(inputs.last()).toHaveValue("Unsent right draft");
    await expect(panes.first().getByRole("button", { name: "Interrupt agent" })).toBeEnabled();
    await panes.first().locator("header").first().focus();
    await page.keyboard.press("Escape");
    await expect(panes.first().getByRole("button", { name: "Interrupt agent" })).toHaveCount(0);
    await expect(inputs.first()).toHaveValue("Unsent left draft");
    await expect(page.getByRole("log").getByText("Do not send this", { exact: true })).toHaveCount(
      0,
    );
  } finally {
    await dispose();
  }
});
