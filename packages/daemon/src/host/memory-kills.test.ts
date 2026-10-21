import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { MemoryKillWatch, parseMemoryKills, ranOutOfMemory } from "./memory-kills.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const done of cleanup.splice(0)) await done();
});

it("reads the kernel's count of processes killed for memory, with its boot", () => {
  expect(parseMemoryKills("pgfault 12\noom_kill 3\npgmajfault 1\n", "boot-a\n")).toEqual({
    boot: "boot-a",
    kills: 3,
  });
  expect(parseMemoryKills("pgfault 12\n", "boot-a")).toBeNull();
});

it("says memory ran out only when the count rose within the same boot", () => {
  const before = { boot: "a", kills: 2 };
  expect(ranOutOfMemory(before, { boot: "a", kills: 3 })).toBe(true);
  expect(ranOutOfMemory(before, { boot: "a", kills: 2 })).toBe(false);
  // A reboot starts the count over; that is a restart, not a sign of memory running out.
  expect(ranOutOfMemory(before, { boot: "b", kills: 5 })).toBe(false);
  expect(ranOutOfMemory(null, { boot: "a", kills: 5 })).toBe(false);
  expect(ranOutOfMemory(before, null)).toBe(false);
});

it("compares with the count it recorded, and stays quiet where none can be read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-memory-kills-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let now: { boot: string; kills: number } | null = { boot: "a", kills: 1 };
  const watch = new MemoryKillWatch(join(directory, "memory-kills.json"), () => now);
  expect(watch.ranOutSinceRecorded()).toBe(false);
  watch.record();
  now = { boot: "a", kills: 2 };
  expect(watch.ranOutSinceRecorded()).toBe(true);
  watch.record();
  expect(watch.ranOutSinceRecorded()).toBe(false);
  const unreadable = new MemoryKillWatch(join(directory, "memory-kills.json"), () => {
    throw new Error("No /proc here");
  });
  expect(unreadable.ranOutSinceRecorded()).toBe(false);
  unreadable.record();
});
