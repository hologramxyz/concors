import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { mockDictation } from "./support/dictation.ts";
import { chooseProvider } from "./support/agents.ts";

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
  await chooseProvider(page);
  const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
  await expect(composer).toBeEnabled();
  return { composer, dispose: () => rm(directory, { recursive: true, force: true }) };
}

test("live waveform replaces input and Enter puts the final words in the prompt box without sending", async ({
  page,
}) => {
  const { composer, dispose } = await workspace(page);
  try {
    // Agent sounds keep one audio context once the page has been clicked; only the microphone
    // meter's own context has to close again.
    const contexts = await page.evaluate(() => window.testDictation.capture.contexts);
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    const recording = page.getByRole("group", { name: "Dictation", exact: true });
    await expect(recording).toBeFocused();
    await expect(composer).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.testDictation.capture.contexts))
      .toBe(contexts + 1);
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
    await expect(composer).toHaveValue("Fix the login bug.");
    await expect(composer).toBeFocused();
    await expect(
      page.getByRole("log").getByText("Fix the login bug.", { exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.testDictation.capture.tracks)).toBe(0);
    await expect
      .poll(() => page.evaluate(() => window.testDictation.capture.contexts))
      .toBe(contexts);
  } finally {
    await dispose();
  }
});

test("Done appends dictation to a focused draft; Cancel preserves the original draft and attachment", async ({
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

test("the recording bar fits a narrow pane and Done keeps the words for sending as usual", async ({
  page,
}) => {
  const { composer, dispose } = await workspace(page);
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 520, height: 850 });
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("Read before sending", true));
    await expect(page.locator("[data-dictation-waveform]")).toHaveCSS("visibility", "hidden");
    await expect(page.getByRole("meter", { name: "Microphone volume" })).toBeVisible();
    const box = page.getByRole("group", { name: "Dictation", exact: true });
    expect(await box.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("dictation-narrow.png") });
    await page.getByRole("button", { name: "Edit dictated message", exact: true }).click();
    await page.evaluate(() => window.testDictation.end());
    await expect(composer).toHaveValue("Read before sending");
    await expect.poll(() => page.evaluate(() => window.testDictation.capture.tracks)).toBe(0);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(composer).toHaveValue("");
    await expect(
      page.getByRole("log").getByText("Read before sending", { exact: true }),
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

test("Send submits the dictated words, and Ctrl+Enter does too", async ({ page }) => {
  const { composer, dispose } = await workspace(page);
  try {
    const log = page.getByRole("log");
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("Send this one", true));
    await page.getByRole("button", { name: "Send dictated message", exact: true }).click();
    await page.evaluate(() => window.testDictation.end());
    await expect(composer).toHaveValue("");
    await expect(log.getByText("Send this one", { exact: true })).toHaveCount(1);
    await expect(page.getByText(/^Worked for /)).toHaveCount(1);

    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("And this one", true));
    await page.keyboard.press("Control+Enter");
    await page.evaluate(() => window.testDictation.end());
    await expect(log.getByText("And this one", { exact: true })).toHaveCount(1);
  } finally {
    await dispose();
  }
});

test("dictating into a long draft adds the words at its end, grows the box and shows the end", async ({
  page,
}) => {
  const { composer, dispose } = await workspace(page);
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    const draft = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the prompt.`).join("\n");
    await composer.fill(draft);
    // Taller than the old 192px cap, yet capped: the rest scrolls.
    const height = await composer.evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(300);
    expect(height).toBeLessThanOrEqual(416);
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("Dictated ending.", true));
    await page.getByRole("button", { name: "Edit dictated message", exact: true }).click();
    await page.evaluate(() => window.testDictation.end());
    await expect(composer).toHaveValue(`${draft} Dictated ending.`);
    await expect(composer).toBeFocused();
    expect(
      await composer.evaluate((element: HTMLTextAreaElement) => ({
        caret: element.selectionStart === element.value.length,
        bottom: element.scrollHeight - element.clientHeight - element.scrollTop <= 1,
      })),
    ).toEqual({ caret: true, bottom: true });

    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("Sent too.", true));
    await page.getByRole("button", { name: "Send dictated message", exact: true }).click();
    await page.evaluate(() => window.testDictation.end());
    await expect(composer).toHaveValue("");
    await expect(page.getByRole("log").getByText(/Dictated ending\. Sent too\.$/)).toHaveCount(1);
  } finally {
    await dispose();
  }
});

test("recording carries on while the window is out of view", async ({ page }) => {
  const { composer, dispose } = await workspace(page);
  try {
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("Before switching", true));
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const recording = page.getByRole("group", { name: "Dictation", exact: true });
    await expect(recording).toHaveAttribute("data-dictation-phase", "recording");
    await expect.poll(() => page.evaluate(() => window.testDictation.capture.tracks)).toBe(1);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.testDictation.result("Before switching and after", true);
    });
    await page.getByRole("button", { name: "Edit dictated message", exact: true }).click();
    await page.evaluate(() => window.testDictation.end());
    await expect(composer).toHaveValue("Before switching and after");
  } finally {
    await dispose();
  }
});

test("a dropped connection's dictation notice clears once the machine is back, and typing dismisses others", async ({
  page,
}) => {
  let refuse = false;
  let drop: () => void = () => undefined;
  await page.routeWebSocket("**/ws", (client) => {
    if (refuse) {
      client.close({ code: 1011, reason: "Unavailable" });
      return;
    }
    client.connectToServer();
    drop = () => client.close({ code: 1001, reason: "Test reconnect" });
  });
  await page.reload();
  const { composer, dispose } = await workspace(page);
  try {
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.result("Words before the drop", true));
    refuse = true;
    drop();
    const notice = page.getByText(
      "Dictation stopped because the connection to this machine dropped",
    );
    await expect(notice).toBeVisible();
    refuse = false;
    // The app restores the connection by itself; the notice goes with the drop it described.
    await expect(notice).toHaveCount(0, { timeout: 15_000 });
    await expect(composer).toHaveValue("Words before the drop");

    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await page.evaluate(() => window.testDictation.error("no-speech"));
    await expect(page.getByRole("alert")).toContainText("No speech was detected");
    await composer.press("End");
    await composer.pressSequentially(".");
    await expect(page.getByText("No speech was detected")).toHaveCount(0);
  } finally {
    await dispose();
  }
});
