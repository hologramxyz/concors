import { expect, it } from "vitest";
import { messageImageIndex } from "./message-images";

const attachments = [
  { name: "prompt.png", mime: "image/png" },
  { name: "desktop.png", mime: "image/png", source: "/tmp/plan icon/desktop.png" },
  { name: "mobile.png", mime: "image/png", source: "shots/mobile%20view.png" },
];

it("finds the kept image for a Markdown destination, however it is encoded", () => {
  expect(messageImageIndex(attachments, "/tmp/plan icon/desktop.png")).toBe(1);
  expect(messageImageIndex(attachments, "/tmp/plan%20icon/desktop.png")).toBe(1);
  expect(messageImageIndex(attachments, "shots/mobile view.png")).toBe(2);
});

it("does not match images that were never kept", () => {
  expect(messageImageIndex(attachments, "prompt.png")).toBe(-1);
  expect(messageImageIndex(attachments, "https://example.com/a.png")).toBe(-1);
  expect(messageImageIndex(undefined, "/tmp/plan icon/desktop.png")).toBe(-1);
  expect(messageImageIndex(attachments, "")).toBe(-1);
});
