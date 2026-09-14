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
    }
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
