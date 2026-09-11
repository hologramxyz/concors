import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("chat presents native forms, plan review, file content and durable attachment previews", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-primitives-ui-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Chat primitives", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Message Codex" });
    const send = async (text: string) => {
      await input.fill(text);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
    };
    await send("primitive-form");
    await expect(page.getByLabel("Agent status: Needs input").first()).toBeVisible();
    await page.getByRole("checkbox", { name: "Unit tests Run the focused suite" }).click();
    await page.getByRole("checkbox", { name: "Type check Verify types" }).click();
    await expect(page.getByRole("textbox", { name: "Additional notes", exact: true })).toHaveValue(
      "Keep the public API stable.",
    );
    await page.getByRole("textbox", { name: "Additional notes", exact: true }).fill("");
    await page.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(page.getByLabel("Agent status: Done").first()).toBeVisible();
    await expect(page.getByRole("log")).toContainText("Unit tests, Type check");
    await send("primitive-plan");
    await expect(
      page.getByRole("heading", { name: "Implementation plan", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Request changes", exact: true }).click();
    await expect(page.getByLabel("Agent status: Done").first()).toBeVisible();
    await send("primitive-read");
    await page
      .getByRole("article", { name: "Tool call", exact: true })
      .getByRole("button")
      .first()
      .click();
    await expect(
      page.getByText("export const previewWorks = true;", { exact: true }),
    ).toBeVisible();
    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: "notes.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Durable attachment preview"),
      });
    await send("Read these notes");
    await expect(page.getByLabel("Agent status: Done").first()).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "notes.md", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("# Durable attachment preview");
    await page.getByRole("button", { name: "Close attachment" }).click();
    await page.screenshot({ path: test.info().outputPath("chat-primitives.png") });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
