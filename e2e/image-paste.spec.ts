import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("pasted images attach, and screenshots over 1 MB are shrunk instead of refused", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-image-paste-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Image paste", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();

    const paste = (name: string, size: number) =>
      composer.evaluate(
        async (input, [name, size]) => {
          // Noise does not compress, so a large square is several megabytes as PNG.
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("No 2D canvas");
          const pixels = context.createImageData(size, size);
          for (let i = 0; i < pixels.data.length; i++)
            pixels.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
          context.putImageData(pixels, 0, 0);
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode")))),
          );
          const transfer = new DataTransfer();
          transfer.items.add(new File([blob], name, { type: "image/png" }));
          input.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true,
            }),
          );
          return blob.size;
        },
        [name, size] as const,
      );

    expect(await paste("screenshot.png", 1400)).toBeGreaterThan(1024 * 1024);
    await expect(page.getByRole("button", { name: "Remove screenshot.jpg" })).toBeVisible();
    expect(await paste("icon.png", 64)).toBeLessThan(1024 * 1024);
    await expect(page.getByRole("button", { name: "Remove icon.png" })).toBeVisible();
    await expect(page.getByText(/larger than 1 MB|too large to attach/)).toHaveCount(0);
    // Before sending, a pasted image can be opened at full size.
    const thumbnail = page.getByRole("button", { name: "Open icon.png" });
    await expect(thumbnail).toHaveCSS("cursor", "pointer");
    await thumbnail.click();
    const viewer = page.getByRole("dialog", { name: "icon.png" });
    await expect(viewer.getByRole("img", { name: "icon.png" })).toBeVisible();
    await viewer.getByRole("button", { name: "Close image" }).click();
    await expect(viewer).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove icon.png" })).toBeAttached();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sent images show as square thumbnails at once, after a reload, and open full size", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-image-thumbnails-"));
  // 2x2 PNGs: red and blue.
  const png = (base64: string) => Buffer.from(base64, "base64");
  const red = png(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  );
  const blue = png(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgYPgPRmAKABf2A/1+6zfzAAAAAElFTkSuQmCC",
  );
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Image thumbnails", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    await page.getByLabel("Upload files").setInputFiles([
      { name: "red.png", mimeType: "image/png", buffer: red },
      { name: "blue.png", mimeType: "image/png", buffer: blue },
    ]);
    const tray = page.locator("[data-composer-attachments]");
    await expect(tray.locator("img")).toHaveCount(2);
    await expect(page.getByRole("status", { name: "Reading attachment" })).toHaveCount(0);
    await composer.fill("What colours are these?");
    await page.getByRole("button", { name: "Send message", exact: true }).click();

    const log = page.getByRole("log");
    const thumbnails = log.locator('[data-image-attachment="ready"]');
    await expect(thumbnails).toHaveCount(2);
    await expect(log.locator("[data-image-attachment=loading]")).toHaveCount(0);
    const size = await thumbnails.first().evaluate((element) => {
      const box = element.getBoundingClientRect();
      return [box.width, box.height];
    });
    expect(size[0]).toBe(size[1]);
    await expect(log.getByRole("button", { name: "red.png", exact: true })).toHaveCount(0);

    // After a reload the images come from the machine, not from what this client sent.
    await page.reload();
    await expect(page.getByRole("log").locator('[data-image-attachment="ready"]')).toHaveCount(2);
    await page.getByRole("button", { name: "Open blue.png", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "blue.png" });
    await expect(viewer.getByRole("img", { name: "blue.png" })).toBeVisible();
    await page.getByRole("button", { name: "Close image" }).click();
    await expect(viewer).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
