import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("images open as large as the window allows, and attachments download", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-attachment-download-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Downloads", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();

    // A wide banner, larger than the old 768px viewer, drawn in the page so it is a real PNG.
    const banner = await composer.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 600;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D canvas");
      context.fillStyle = "#3b6ea5";
      context.fillRect(0, 0, 1200, 600);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode")))),
      );
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await page.getByLabel("Upload files").setInputFiles([
      { name: "banner.png", mimeType: "image/png", buffer: Buffer.from(banner) },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Ship it on Friday.\n") },
    ]);
    await expect(page.locator("[data-composer-attachments]").locator("img")).toHaveCount(1);
    await expect(page.getByRole("status", { name: "Reading attachment" })).toHaveCount(0);

    // An image still being written has nothing to download yet.
    await page.getByRole("button", { name: "Open banner.png", exact: true }).click();
    const draft = page.getByRole("dialog", { name: "banner.png" });
    await expect(draft.getByRole("img", { name: "banner.png" })).toBeVisible();
    await expect(draft.getByRole("button", { name: /^Download/ })).toHaveCount(0);
    await draft.getByRole("button", { name: "Close image" }).click();

    await composer.fill("Here is the banner");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const log = page.getByRole("log");
    await expect(log.locator('[data-image-attachment="ready"]')).toHaveCount(1);

    await log.getByRole("button", { name: "Open banner.png", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "banner.png" });
    const image = viewer.getByRole("img", { name: "banner.png" });
    await expect(image).toBeVisible();
    // Shown at its own size in a 1360px window, not squeezed into a fixed-width modal.
    await expect
      .poll(async () => (await image.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(1199);
    await page.screenshot({ path: test.info().outputPath("image-viewer.png") });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      viewer.getByRole("button", { name: "Download banner.png", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("banner.png");
    expect(await readFile(await download.path())).toEqual(Buffer.from(banner));
    await expect(viewer.getByRole("button", { name: "Download banner.png" })).toHaveAttribute(
      "title",
      "Saved to Downloads",
    );
    await viewer.getByRole("button", { name: "Close image" }).click();

    await log.getByRole("button", { name: "notes.txt", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "notes.txt" });
    await expect(preview).toContainText("Ship it on Friday.");
    const [text] = await Promise.all([
      page.waitForEvent("download"),
      preview.getByRole("button", { name: "Download notes.txt", exact: true }).click(),
    ]);
    expect(text.suggestedFilename()).toBe("notes.txt");
    expect(await readFile(await text.path(), "utf8")).toBe("Ship it on Friday.\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
