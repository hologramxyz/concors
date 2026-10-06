import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("documents dropped on the composer attach and are sent with the message", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-composer-drop-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Composer drop", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    const form = page.locator("form").filter({ has: composer });
    const files = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["%PDF-1.4\n% fixture\n"], "spec.pdf", { type: "application/pdf" }),
      );
      transfer.items.add(new File(["Meeting notes"], "notes.md", { type: "text/markdown" }));
      return transfer;
    });

    await composer.dispatchEvent("dragenter", { dataTransfer: files });
    await composer.dispatchEvent("dragover", { dataTransfer: files });
    await expect(form).toHaveAttribute("data-dropping", "true");
    await expect(form.getByText("Drop files to attach", { exact: true })).toBeVisible();
    await composer.dispatchEvent("drop", { dataTransfer: files });
    await expect(form).not.toHaveAttribute("data-dropping");
    await expect(page.getByRole("button", { name: "Remove spec.pdf", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove notes.md", exact: true })).toBeVisible();

    // Leaving without dropping clears the highlight.
    await composer.dispatchEvent("dragenter", { dataTransfer: files });
    await expect(form).toHaveAttribute("data-dropping", "true");
    await composer.dispatchEvent("dragleave", { dataTransfer: files });
    await expect(form).not.toHaveAttribute("data-dropping");

    // A file dropped outside the composer is refused instead of opening in the window.
    const elsewhere = await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["x"], "stray.txt", { type: "text/plain" }));
      const over = new DragEvent("dragover", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      });
      const drop = new DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(over);
      document.body.dispatchEvent(drop);
      return {
        over: over.defaultPrevented,
        effect: transfer.dropEffect,
        drop: drop.defaultPrevented,
      };
    });
    expect(elsewhere).toEqual({ over: true, effect: "none", drop: true });
    await expect(page.getByRole("button", { name: "Remove stray.txt" })).toHaveCount(0);

    await composer.fill("Summarise these");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const log = page.getByRole("log");
    await expect(log.getByRole("button", { name: "spec.pdf", exact: true })).toBeVisible();
    await log.getByRole("button", { name: "notes.md", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Meeting notes");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
