import { expect, it } from "vitest";
import { previewKind } from "./preview-kind";

it("previews PDFs and raster images, and leaves everything else to the editor", () => {
  expect(previewKind("docs/Concors-Messaging.pdf")).toBe("pdf");
  expect(previewKind("SHOT.PNG")).toBe("image");
  expect(previewKind("a/photo.jpeg")).toBe("image");
  expect(previewKind("a/photo.jpg")).toBe("image");
  expect(previewKind("loop.gif")).toBe("image");
  expect(previewKind("hero.webp")).toBe("image");
  expect(previewKind("clips/13-before-after.mp4")).toBe("video");
  expect(previewKind("CLIP.MOV")).toBe("video");
  expect(previewKind("a.m4v")).toBe("video");
  expect(previewKind("a.webm")).toBe("video");
  // No webview here plays these, so they stay with the editor's "not a text file" message.
  expect(previewKind("a.mkv")).toBeNull();
  // SVG is text: it opens in the editor, where it can be read and changed.
  expect(previewKind("logo.svg")).toBeNull();
  expect(previewKind("pdf.ts")).toBeNull();
  expect(previewKind("README.md")).toBeNull();
});
