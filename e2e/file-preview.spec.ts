import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

/** A one-page PDF whose page is filled red, with a correct cross-reference table. */
function redPdf() {
  const content = "1 0 0 rg 0 0 300 300 re f";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

/** A fifth of a second of 16×16 VP8, which the open-source Chromium the tests run can decode. */
const WEBM = Buffer.from(
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIXEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggIB7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDBXQYxMYXZmNjEuNy4xMDBEiYhAaQAAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIhGcM8TYRXVGcgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QF9eEA4JCwgRC6gRCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAwc3PWY8CLY8WIhGcM8TYRXVFnyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjIwMDAwMDAwMAAfQ7Z12eeBAKO9gQAAgPACAJ0BKhAAEAAARwiFhYiFhIgCAgJ1qgP4A/oCDU0YAP79bvP/45k3MMT/jm3/8WE8DijI//FRAKOVgQBkALEBAAEQEAAYABhYL/QACAAAHFO7a5G7j7OBALeK94EB8YIBo/CBAw==",
  "base64",
);

/** A 1080p clip, larger than any tab here, to check a video is fitted and not cropped. */
const WIDE_WEBM = Buffer.from(
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAABB7EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsghBl7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDBXQYxMYXZmNjEuNy4xMDBEiYhAeQAAAAAAABZUrmvKrgEAAAAAAABB14EBc8WI3E3cRZtcC9ScgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JKwggeAuoIEOJqBAlWwhFW5gQESVMNn+3Nzn2PAgGfImUWjh0VOQ09ERVJEh4xMYXZmNjEuNy4xMDBzc9ZjwItjxYjcTdxFm1wL1GfIoUWjh0VOQ09ERVJEh5RMYXZjNjEuMTkuMTAxIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDAuNDAwMDAwMDAwAB9DtnVOuueBAKNN4oEAAICQtwGdASqABzgEAEcIhYWIhYSIAgICdaoCBmZlaX2vbmyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4eyc4evQ/v+N5P/9tA//bQP/20D/7aB/jebzWrEAo0DPgQDIAPEYAA8R/AAYABhYL/QX+gYGC/0DACRAgAAgAAQAAIAAEAACAEm21m22g22v220o22O22q22zG21u22i22w220222Q22s22zm21222jG2xm21G22U22s220G21+22lG2x221W22Y22t220W22G22m22yG21m22c22u220Y22M22o22ym21m22g22v220o22O22q22zG21u22i22w220222Q22s22zm21222jG2xm21G22U22s220G21+22lG2x221W22Y22t220W20wAHFO7a5G7j7OBALeK94EB8YIBpfCBAw==",
  "base64",
);

test("videos play in a file tab, and one that cannot play says so", async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), "concors-video-preview-"));
  writeFileSync(join(root, "clip.webm"), WEBM);
  writeFileSync(join(root, "broken.mp4"), "not really a video");
  writeFileSync(join(root, "wide.webm"), WIDE_WEBM);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Video test", root);
    await page.getByRole("button", { name: "Toggle project files" }).click();
    const tree = page.getByRole("complementary", { name: "Project files" });

    await tree.getByRole("button", { name: "clip.webm", exact: true }).click();
    const tab = page.getByRole("region", { name: "File clip.webm" });
    const video = tab.getByLabel("Video clip.webm");
    await expect(video).toBeVisible();
    // Really decoded, not just laid out: the player knows the clip's size and length.
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth))
      .toBe(16);
    expect(await video.evaluate((element: HTMLVideoElement) => element.duration)).toBeGreaterThan(
      0,
    );
    await expect(video).toHaveAttribute("controls");
    // Shows its first frame before anyone presses play: WebKit, the Mac's and iPhone's webview,
    // draws none until a video is played or moved, so the tab steps it to its first instant.
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => [
          element.paused,
          element.currentTime > 0,
          element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
        ]),
      )
      .toEqual([true, true, true]);
    await expect(tab.getByText(/Read-only preview, \d+ (B|KB)/)).toBeVisible();

    await page.screenshot({ path: test.info().outputPath("video.png") });

    await tree.getByRole("button", { name: "wide.webm", exact: true }).click();
    const wideTab = page.getByRole("region", { name: "File wide.webm" });
    const wide = wideTab.getByLabel("Video wide.webm");
    await expect
      .poll(() => wide.evaluate((element: HTMLVideoElement) => element.videoWidth))
      .toBe(1920);
    // Whole inside the tab, above the status line, keeping its shape.
    const [box, tabBox, status] = await Promise.all([
      wide.boundingBox(),
      wideTab.boundingBox(),
      wideTab.getByText(/Read-only preview/).boundingBox(),
    ]);
    if (!box || !tabBox || !status) throw new Error("Video or tab missing");
    expect(box.x).toBeGreaterThanOrEqual(tabBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(tabBox.x + tabBox.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(status.y + 1);
    await page.screenshot({ path: test.info().outputPath("video-wide.png") });

    await tree.getByRole("button", { name: "broken.mp4", exact: true }).click();
    const broken = page.getByRole("region", { name: "File broken.mp4" });
    await expect(broken.getByText("This video can’t play here")).toBeVisible();
    await expect(broken.getByText("not a UTF-8 text file")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("video-unplayable.png") });
    expect(errors).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PDFs and images open in a read-only preview instead of the text editor", async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), "concors-file-preview-"));
  writeFileSync(join(root, "Messaging.pdf"), redPdf());
  writeFileSync(join(root, "dot.png"), PNG);
  writeFileSync(join(root, "fake.pdf"), "not really a PDF");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Preview test", root);
    await page.getByRole("button", { name: "Toggle project files" }).click();
    const tree = page.getByRole("complementary", { name: "Project files" });

    await tree.getByRole("button", { name: "Messaging.pdf", exact: true }).click();
    const pdf = page.getByRole("region", { name: "File Messaging.pdf" });
    const firstPage = pdf.getByLabel("Page 1", { exact: true });
    await expect(firstPage).toBeVisible();
    await expect(pdf.getByText("This is not a UTF-8 text file")).toHaveCount(0);
    // The page is drawn, not just laid out: its centre is the PDF's red.
    await expect
      .poll(() =>
        firstPage.evaluate((canvas: HTMLCanvasElement) => {
          const context = canvas.getContext("2d");
          if (!context || !canvas.width) return null;
          const [r, g, b] = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
          return r > 200 && g < 60 && b < 60;
        }),
      )
      .toBe(true);
    await expect(pdf.getByText(/Read-only preview, \d+ B/)).toBeVisible();

    await tree.getByRole("button", { name: "dot.png", exact: true }).click();
    const image = page.getByRole("img", { name: "dot.png", exact: true });
    await expect(image).toBeVisible();
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

    // The machine checks the bytes, so a text file named .pdf explains instead of rendering junk.
    await tree.getByRole("button", { name: "fake.pdf", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "File fake.pdf" }).getByRole("alert"),
    ).toContainText("Concors can preview PDF, PNG, JPEG, GIF and WebP files");
    expect(errors).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PDF and image previews zoom in and out, and back to fit", async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), "concors-preview-zoom-"));
  writeFileSync(join(root, "Messaging.pdf"), redPdf());
  writeFileSync(join(root, "dot.png"), PNG);
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Zoom test", root);
    await page.getByRole("button", { name: "Toggle project files" }).click();
    const tree = page.getByRole("complementary", { name: "Project files" });
    await tree.getByRole("button", { name: "Messaging.pdf", exact: true }).click();
    const pdf = page.getByRole("region", { name: "File Messaging.pdf" });
    const firstPage = pdf.getByLabel("Page 1", { exact: true });
    await expect(firstPage).toBeVisible();
    const width = async () => (await firstPage.boundingBox())?.width ?? 0;
    const pixels = () => firstPage.evaluate((canvas: HTMLCanvasElement) => canvas.width);
    await expect.poll(pixels).toBeGreaterThan(300);
    const fit = await width();
    const drawn = await pixels();
    const label = pdf.getByRole("button", { name: /^Zoom \d+%/ });
    await expect(label).toHaveText("100%");

    await pdf.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(label).toHaveText("110%");
    await firstPage.click();
    await page.keyboard.press("ControlOrMeta+=");
    await expect(label).toHaveText("125%");
    expect(await width()).toBeCloseTo(fit * 1.25, 0);
    // The page is drawn again at the new size, not just stretched.
    await expect.poll(pixels).toBeGreaterThan(drawn * 1.2);
    await pdf.screenshot({ path: test.info().outputPath("pdf-zoomed.png") });
    // A trackpad pinch, as Chromium reports one: a wheel event with Ctrl set.
    await firstPage.dispatchEvent("wheel", { deltaY: -40, ctrlKey: true, bubbles: true });
    await expect
      .poll(async () => Number((await label.textContent())?.slice(0, -1)))
      .toBeGreaterThan(125);
    await page.keyboard.press("ControlOrMeta+-");
    await pdf.getByRole("button", { name: "Zoom out", exact: true }).click();
    await label.click();
    await expect(label).toHaveText("100%");
    expect(await width()).toBeCloseTo(fit, 0);

    // An image's fit is its own size when it is small; zooming scales it from there.
    await tree.getByRole("button", { name: "dot.png", exact: true }).click();
    const preview = page.getByRole("region", { name: "File dot.png" });
    const image = preview.getByRole("img", { name: "dot.png", exact: true });
    await expect(image).toBeVisible();
    await preview.getByRole("button", { name: "Zoom in", exact: true }).click();
    await preview.getByRole("button", { name: "Zoom in", exact: true }).click();
    await preview.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(preview.getByRole("button", { name: /^Zoom \d+%/ })).toHaveText("150%");
    await expect.poll(async () => (await image.boundingBox())?.width).toBeCloseTo(1.5, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
