import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { mockDictation } from "./support/dictation.ts";

test.beforeEach(async ({ page }) => {
  await signedIn(page);
  await mockDictation(page);
  await page.goto("/");
});

async function workspace(page: Page) {
  const directory = await mkdtemp(join(tmpdir(), "concors-dictation-"));
  await seedProject(page, "Dictation workspace", directory);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
  await expect(composer).toBeEnabled();
  return { composer, dispose: () => rm(directory, { recursive: true, force: true }) };
}

test("live waveform replaces input and Enter waits for final words before sending once", async ({
  page,
}) => {
  const { composer, dispose } = await workspace(page);
  try {
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    const recording = page.getByRole("group", { name: "Dictation", exact: true });
    await expect(recording).toBeFocused();
    await expect(composer).toHaveCount(0);
    const meter = page.getByRole("meter", { name: "Microphone volume" });
    await expect(meter).toHaveAttribute("aria-valuenow", "67");
    await page.evaluate(() => {
      window.testDictation.capture.volume = 0;
    });
    await expect(meter).toHaveAttribute("aria-valuenow", "0");
    await page.evaluate(() => {
      window.testDictation.capture.volume = 0.1;
      window.testDictation.result("Fix the login");
    });
    await expect(meter).toHaveAttribute("aria-valuenow", "67");
    await page.screenshot({ path: test.info().outputPath("dictation-recording.png") });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(recording).toHaveAttribute("data-dictation-phase", "stopping");
    await expect.poll(() => page.evaluate(() => window.testDictation.capture.stops)).toBe(1);
    await expect(page.getByRole("log").getByText("Fix the login", { exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      window.testDictation.result("Fix the login bug.", true);
      window.testDictation.end();
      window.testDictation.end();
    });
    await expect(recording).toHaveCount(0);
    await expect(composer).toHaveValue("");
    await expect(
      page.getByRole("log").getByText("Fix the login bug.", { exact: true }),
    ).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.testDictation.capture.tracks)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.testDictation.capture.contexts)).toBe(0);
  } finally {
    await dispose();
  }
});

test("Edit finishes dictation into a focused draft; Cancel preserves the original draft and attachment", async ({
  page,
}) => {
  const { composer, dispose } = await workspace(page);
  try {
    await composer.fill("Existing draft:");
    await page
      .getByLabel("Upload files")
      .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("discard this", true));
    await page.keyboard.press("Escape");
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("Existing draft:");
    await expect(page.getByRole("button", { name: "Remove notes.txt" })).toBeVisible();
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("some words"));
    await page.getByRole("button", { name: "Edit dictated message" }).click();
    await page.evaluate(() => {
      window.testDictation.result("some final words.", true);
      window.testDictation.end();
    });
    await expect(composer).toHaveValue("Existing draft: some final words.");
    await expect(composer).toBeFocused();
    await expect(
      page.getByRole("log").getByText("Existing draft: some final words.", { exact: true }),
    ).toHaveCount(0);
    await composer.fill("Edited dictation.");
    await composer.press("Enter");
    await expect(page.getByRole("log").getByText("Edited dictation.", { exact: true })).toHaveCount(
      1,
    );
  } finally {
    await dispose();
  }
});

test("Stop shows a review and click Send uses the normal message path", async ({ page }) => {
  const { composer, dispose } = await workspace(page);
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("Review before sending", true));
    await expect(page.locator("[data-dictation-waveform]")).toHaveCSS("visibility", "hidden");
    await expect(page.getByRole("meter", { name: "Microphone volume" })).toBeVisible();
    await page.getByRole("button", { name: "Stop dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.end());
    await expect(page.getByLabel("Dictation transcript")).toHaveText("Review before sending");
    await expect.poll(() => page.evaluate(() => window.testDictation.capture.tracks)).toBe(0);
    await page.setViewportSize({ width: 520, height: 850 });
    const box = page.getByRole("group", { name: "Dictation", exact: true });
    expect(await box.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("dictation-review-narrow.png") });
    await page.getByRole("button", { name: "Send dictated message" }).click();
    await expect(composer).toHaveValue("");
    await expect(
      page.getByRole("log").getByText("Review before sending", { exact: true }),
    ).toHaveCount(1);
  } finally {
    await dispose();
  }
});

test("permission failure and empty dictation never submit the existing draft", async ({ page }) => {
  const { composer, dispose } = await workspace(page);
  try {
    await composer.fill("Keep my original draft");
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.error("not-allowed"));
    await expect(page.getByRole("alert")).toContainText("Allow microphone access");
    await expect(composer).toHaveValue("Keep my original draft");
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.keyboard.press("Enter");
    await page.evaluate(() => window.testDictation.end());
    await expect(composer).toHaveValue("Keep my original draft");
    await expect(
      page.getByRole("log").getByText("Keep my original draft", { exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.testDictation.capture.tracks)).toBe(0);
  } finally {
    await dispose();
  }
});

test("changing tabs stops capture and preserves dictated words for editing", async ({ page }) => {
  const { composer, dispose } = await workspace(page);
  try {
    const agentTab = page.getByRole("button", { name: "Tab 2", exact: true });
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("Save my words", true));
    await page.getByRole("button", { name: "Tab 1", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.testDictation.capture.tracks)).toBe(0);
    await agentTab.click();
    await expect(composer).toHaveValue("Save my words");
    await expect(page.getByRole("group", { name: "Dictation", exact: true })).toHaveCount(0);
  } finally {
    await dispose();
  }
});
