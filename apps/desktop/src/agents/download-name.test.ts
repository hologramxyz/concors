import { expect, it } from "vitest";
import { downloadName } from "./download-name";

it("gives an image named only in prose the extension its type implies", () => {
  expect(downloadName("Always-on banner", "image/png")).toBe("Always-on banner.png");
  expect(downloadName("photo", "image/jpeg")).toBe("photo.jpg");
  expect(downloadName("banner.png", "image/png")).toBe("banner.png");
  expect(downloadName("v2.1 release", "image/webp")).toBe("v2.1 release.webp");
  expect(downloadName("notes.txt", "text/plain")).toBe("notes.txt");
  expect(downloadName("README", "text/plain")).toBe("README");
});
