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
    await expect(pdf.getByText(/Read-only preview · \d+ B/)).toBeVisible();

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
