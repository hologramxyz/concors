import { expect, it } from "vitest";
import { createPreviewStore, validPreviewUrl } from "./preview-links";

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

it("keeps named preview links separate from machine processes and supports edits and removal", () => {
  const first = createPreviewStore();
  const second = createPreviewStore();
  first.setLink("web", "https://web.example", " Web app ");
  expect(first.getSnapshot()).toEqual({ web: { name: "Web app", url: "https://web.example/" } });
  expect(second.getSnapshot()).toEqual({});
  first.setLink("web", "javascript:alert(1)", "Unsafe");
  expect(first.getSnapshot().web?.name).toBe("Web app");
  first.setLink("web", "https://branch.example", "Feature preview");
  expect(first.getSnapshot().web?.url).toBe("https://branch.example/");
  first.removeLink("web");
  expect(first.getSnapshot()).toEqual({});
});
