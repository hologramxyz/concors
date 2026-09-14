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
    await expect(dialog.getByRole("button", { name: /^CLI session / })).toBeVisible();
    await dialog.getByLabel("Saved sessions").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(dialog.getByRole("button", { name: /^Older CLI session 125 / })).toBeAttached();
    await expect(
      page.getByRole("textbox", { name: "Message Codex", exact: true, includeHidden: true }),
    ).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Search sessions" }).fill("125");
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
