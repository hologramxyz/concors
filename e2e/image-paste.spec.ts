import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
