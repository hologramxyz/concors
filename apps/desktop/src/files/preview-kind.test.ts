import { expect, it } from "vitest";
import { previewKind } from "./preview-kind";

it("previews PDFs and raster images, and leaves everything else to the editor", () => {
  expect(previewKind("docs/Concors-Messaging.pdf")).toBe("pdf");
  expect(previewKind("SHOT.PNG")).toBe("image");
  expect(previewKind("a/photo.jpeg")).toBe("image");
  expect(previewKind("a/photo.jpg")).toBe("image");
  expect(previewKind("loop.gif")).toBe("image");
  expect(previewKind("hero.webp")).toBe("image");
  // SVG is text: it opens in the editor, where it can be read and changed.
  expect(previewKind("logo.svg")).toBeNull();
  expect(previewKind("pdf.ts")).toBeNull();
  expect(previewKind("README.md")).toBeNull();
});
