import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("resume finds older native sessions, protects drafts, and keeps the same pane", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-resume-ui-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Resume workspace", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
    const resume = page.getByRole("button", { name: "Resume session", exact: true });
    await expect(composer).toBeEnabled();
    await expect(resume).toBeEnabled();
    await composer.fill("Do not lose my draft");
    await expect(resume).toBeDisabled();
    await composer.fill("");
    await resume.click();
    const dialog = page.getByRole("dialog", { name: "Resume session", exact: true });
    await expect(dialog.getByRole("textbox", { name: "Search sessions" })).toHaveValue("");
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await expect(dialog.getByRole("heading")).toHaveCSS("font-size", "16px");
    const filters = dialog.getByRole("group", { name: "Filter sessions by provider" });
    await expect(filters.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const provider of ["codex", "claude", "opencode", "pi"]) {
      const row = dialog.locator(`[data-session-provider="${provider}"]`).first();
      await expect(row).toBeVisible();
      await expect(row.locator("[data-session-provider-icon]")).toBeVisible();
      const filter = filters.locator(`[data-session-filter="${provider}"]`);
      await filter.scrollIntoViewIfNeeded();
      await expect(filter.locator("[data-session-filter-icon]")).toBeVisible();
      expect(
        await filter.evaluate((element) => {
          const button = element.getBoundingClientRect();
          const icon = element.querySelector("[data-session-filter-icon]")?.getBoundingClientRect();
          return (
            !!icon &&
            icon.left >= button.left &&
            icon.right <= button.right &&
            icon.top >= button.top &&
            icon.bottom <= button.bottom
          );
        }),
      ).toBe(true);
    }
    await filters.evaluate((element) => {
      element.scrollLeft = 0;
    });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const actions = dialog.locator('[data-slot="dialog-actions"]');
    await expect(actions.getByRole("button", { name: "Refresh sessions" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("resume-all-desktop.png") });
    await filters.getByRole("button", { name: "Codex", exact: true }).click();
    await expect(dialog.locator('[data-session-provider="claude"]')).toHaveCount(0);
    await filters.getByRole("button", { name: "All", exact: true }).click();
    await expect(dialog.locator('[data-session-provider="claude"]').first()).toBeVisible();
    await actions.getByRole("button", { name: "Refresh sessions" }).click();
    await expect(dialog.locator('[data-session-provider="claude"]').first()).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Search sessions" })).toHaveValue("");
    await filters.getByRole("button", { name: "Codex", exact: true }).click();
    await expect
      .poll(async () => {
        await dialog.getByLabel("Saved sessions").evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        return dialog.getByRole("button", { name: /^Older CLI session 125 / }).count();
      })
      .toBe(1);
    await expect(
      page.getByRole("textbox", { name: "Message Codex", exact: true, includeHidden: true }),
    ).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Search sessions" }).fill("125");
    await expect(dialog.locator("[data-session-provider]")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: /^Older CLI session 125 / })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("resume-picker-desktop.png") });
    await dialog.getByRole("button", { name: /^Older CLI session 125 / }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("log")).toContainText("Saved CLI prompt");
    await expect(page.getByRole("log")).toContainText("Saved CLI response");
    await expect(resume).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Close .* tab$/ })).toHaveCount(2);
    await composer.fill("Continue this saved session");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from");
    await page.screenshot({ path: test.info().outputPath("resumed-desktop.png") });
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume focuses an already open session instead of making a duplicate", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-resume-open-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Existing resume", directory);
    const newChat = async () => {
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Message Codex", exact: true })).toBeEnabled();
    };
    const pick = async () => {
      await page.getByRole("button", { name: "Resume session", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("group", { name: "Filter sessions by provider" })
        .getByRole("button", { name: "Codex", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^CLI session / })
        .click();
      await expect(page.getByRole("log")).toContainText("Saved CLI response");
    };
    await newChat();
    await pick();
    await newChat();
    await pick();
    await expect(page.getByRole("button", { name: /^Close .* tab$/ })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Tab 2", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a renamed session is listed and resumed under its pane name", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-resume-named-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Named resume", directory);
    const pane = page.getByRole("region", { name: "Agent pane", exact: true });
    const dialog = page.getByRole("dialog", { name: "Resume session", exact: true });
    // Session 42 is used by no other test; the daemon is shared and a session has one workspace.
    const pick = async (search: string, name: RegExp) => {
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Message Codex", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Resume session", exact: true }).click();
      await dialog
        .getByRole("group", { name: "Filter sessions by provider" })
        .getByRole("button", { name: "Codex", exact: true })
        .click();
      await dialog.getByRole("textbox", { name: "Search sessions" }).fill(search);
      await expect(dialog.locator("[data-session-provider]")).toHaveCount(1);
      await dialog.getByRole("button", { name }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("log")).toContainText("Saved CLI response");
    };
    await pick("session 42", /^Older CLI session 42 /);
    await pane.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Rename pane" }).click();
    await pane.getByRole("textbox", { name: "Pane name", exact: true }).fill("Hello world");
    await page.keyboard.press("Enter");
    await expect(pane.locator("header").getByText("Hello world", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close Tab 2 tab", exact: true }).click();
    await expect(pane).toHaveCount(0);

    // Found by the name given to it, not only by the CLI's title.
    await pick("hello", /^Hello world /);
    await expect(pane.locator("header").getByText("Hello world", { exact: true })).toBeVisible();
    await expect(page.getByText("Loading conversation…")).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a long resumed session opens at its latest messages without scrolling down", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-resume-long-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Long resume", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex", exact: true })).toBeEnabled();
    // Record every painted frame from the moment the session is picked.
    await page.evaluate(() => {
      const frames: { items: number; fromBottom: number; first: string | null }[] = [];
      (window as unknown as { frames_: typeof frames }).frames_ = frames;
      const sample = () => {
        const log = document.querySelector<HTMLElement>('[role="log"]');
        if (log)
          frames.push({
            items: log.querySelectorAll("[data-message-id]").length,
            fromBottom: log.scrollHeight - log.scrollTop - log.clientHeight,
            first: log.querySelector<HTMLElement>("[data-message-id]")?.dataset.messageId ?? null,
          });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.getByRole("button", { name: "Resume session", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Resume session", exact: true });
    await dialog
      .getByRole("group", { name: "Filter sessions by provider" })
      .getByRole("button", { name: "Codex", exact: true })
      .click();
    await dialog.getByRole("textbox", { name: "Search sessions" }).fill("session 77");
    await expect(dialog.locator("[data-session-provider]")).toHaveCount(1);
    await dialog.getByRole("button", { name: /^Older CLI session 77 / }).click();
    await expect(page.getByRole("log")).toContainText("Long session response 80");
    await page.waitForTimeout(1000);
    const frames = await page.evaluate(
      () =>
        (
          window as unknown as {
            frames_: { items: number; fromBottom: number; first: string | null }[];
          }
        ).frames_,
    );
    const shown = frames.filter((frame) => frame.items);
    expect(shown.length).toBeGreaterThan(0);
    // Never painted the start of the history, and always painted at the bottom.
    expect(shown.filter((frame) => frame.first === "long-user-1")).toEqual([]);
    expect(shown.filter((frame) => frame.fromBottom > 2)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
