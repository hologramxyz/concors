import { expect, it } from "vitest";
import { validPreviewUrl } from "./preview-links";

it("accepts only explicitly supplied HTTP(S) links without embedded credentials", () => {
  expect(validPreviewUrl("https://preview.example/test")).toBe("https://preview.example/test");
  expect(validPreviewUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  expect(validPreviewUrl("http://localhost:3000", true)).toBeNull();
  expect(validPreviewUrl("https://preview.example", true)).toBe("https://preview.example/");
  for (const value of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:secret@example.com",
    "/relative",
  ])
    expect(validPreviewUrl(value)).toBeNull();
});
