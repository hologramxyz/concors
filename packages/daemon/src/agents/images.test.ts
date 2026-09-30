import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { MAX_MESSAGE_IMAGES } from "@concors/protocol";
import {
  MAX_IMAGE_BYTES,
  imageMime,
  imageReferences,
  localImagePath,
  readMessageImages,
} from "./images.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), "concors-images-"));
  directories.push(path);
  return path;
}

it("finds Markdown image destinations in prose, once each, and not in code", () => {
  expect(
    imageReferences(
      [
        'Here it is: ![Desktop](/tmp/shot/desktop.png) and ![](<shots/my view.png> "title").',
        "Again ![Desktop](/tmp/shot/desktop.png), escaped ![x](a\\_b.png).",
        "Inline `![not](code.png)` stays text.",
        "```md",
        "![fenced](fenced.png)",
        "```",
        "A [link](/tmp/link.png) is not an image.",
      ].join("\n"),
    ),
  ).toEqual(["/tmp/shot/desktop.png", "shots/my view.png", "a_b.png"]);
});

it("resolves local destinations and refuses web addresses", () => {
  // Absolute paths and file URLs are this machine's own, so a drive letter on Windows.
  const repo = resolve("/repo");
  const absolute = resolve("/tmp/a.png");
  expect(localImagePath(absolute, repo)).toBe(absolute);
  expect(localImagePath("shots/a%20b.png", repo)).toBe(join(repo, "shots", "a b.png"));
  expect(localImagePath(pathToFileURL(absolute).href, repo)).toBe(absolute);
  expect(localImagePath("~/a.png", repo)).toBe(join(homedir(), "a.png"));
  expect(localImagePath("https://example.com/a.png", repo)).toBeNull();
  expect(localImagePath("data:image/png;base64,AAAA", repo)).toBeNull();
});

it("recognises image formats by their bytes", () => {
  expect(imageMime(PNG)).toBe("image/png");
  expect(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  expect(imageMime(Buffer.from("GIF89a"))).toBe("image/gif");
  expect(imageMime(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  expect(imageMime(Buffer.from("<svg></svg>"))).toBeNull();
});

it("keeps readable images and leaves out missing, oversized and non-image files", () => {
  const root = directory();
  mkdirSync(join(root, "shots"));
  writeFileSync(join(root, "shots", "desktop.png"), PNG);
  writeFileSync(join(root, "notes.png"), "not really an image");
  writeFileSync(join(root, "huge.png"), Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]));
  const images = readMessageImages(
    "![a](shots/desktop.png) ![b](missing.png) ![c](notes.png) ![d](huge.png) ![e](shots)",
    root,
  );
  expect(images).toEqual([
    {
      source: "shots/desktop.png",
      attachment: { name: "desktop.png", mime: "image/png", data: PNG.toString("base64") },
    },
  ]);
});

it("keeps at most the images one message can carry", () => {
  const root = directory();
  const markdown = Array.from({ length: MAX_MESSAGE_IMAGES + 2 }, (_, index) => {
    writeFileSync(join(root, `${index}.png`), PNG);
    return `![${index}](${index}.png)`;
  }).join(" ");
  expect(readMessageImages(markdown, root)).toHaveLength(MAX_MESSAGE_IMAGES);
});
