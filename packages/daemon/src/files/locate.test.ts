import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MAX_LOCATED_FILES } from "@concors/protocol";
import { locateProjectFile } from "./locate.ts";

let root: string;
let outside: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "concors-locate-"));
  outside = await mkdtemp(join(tmpdir(), "concors-locate-outside-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});
async function file(path: string, modified?: number) {
  const full = join(root, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, "x");
  if (modified) await utimes(full, modified, modified);
}

it("answers with the path itself when it exists, even if another copy is newer", async () => {
  await file("clips/a.mp4", 1000);
  await file("render/clips/a.mp4", 2000);
  expect(await locateProjectFile(root, "clips/a.mp4")).toEqual(["clips/a.mp4"]);
});

it("finds a path written relative to a folder the agent moved into", async () => {
  await file("render/out/clips/a.mp4");
  expect(await locateProjectFile(root, "clips/a.mp4")).toEqual(["render/out/clips/a.mp4"]);
});

it("puts the newest match first", async () => {
  await file("old/clips/a.mp4", 1000);
  await file("new/clips/a.mp4", 2000);
  expect(await locateProjectFile(root, "clips/a.mp4")).toEqual([
    "new/clips/a.mp4",
    "old/clips/a.mp4",
  ]);
});

it("matches whole path segments, not the tail of a name", async () => {
  await file("x/myclips/a.mp4");
  await file("x/clips/aa.mp4");
  expect(await locateProjectFile(root, "clips/a.mp4")).toEqual([]);
});

it("answers with nothing when nothing matches", async () => {
  await file("render/b.mp4");
  expect(await locateProjectFile(root, "a.mp4")).toEqual([]);
});

it("skips dependency folders, and does not follow links out of the project", async () => {
  await file("node_modules/pkg/clips/a.mp4");
  await writeFile(join(outside, "a.mp4"), "secret");
  await symlink(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
  expect(await locateProjectFile(root, "a.mp4")).toEqual([]);
});

it("refuses a path that climbs out of the project", async () => {
  await expect(locateProjectFile(root, "../a.mp4")).rejects.toThrow("inside this project");
});

it("gives up at its limit instead of walking a huge tree", async () => {
  await file("a/b/c/d/clip.mp4");
  expect(await locateProjectFile(root, "clip.mp4", { entries: 2 })).toEqual([]);
});

it("returns a bounded list", async () => {
  for (let index = 0; index < MAX_LOCATED_FILES + 2; index++) await file(`d${index}/a.mp4`);
  expect(await locateProjectFile(root, "a.mp4")).toHaveLength(MAX_LOCATED_FILES);
});
