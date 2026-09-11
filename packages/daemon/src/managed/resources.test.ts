import { expect, it } from "vitest";
import { collectMachineResources, parseMemoryCapacity } from "./resources.ts";

it("uses available memory including reclaimable cache, not just free RAM", () => {
  expect(
    parseMemoryCapacity("MemTotal: 8000 kB\nMemFree: 100 kB\nMemAvailable: 3000 kB\n"),
  ).toEqual({ totalBytes: 8192000, availableBytes: 3072000 });
});
it.each([
  "",
  "MemTotal: 8000 kB",
  "MemTotal: 0 kB\nMemAvailable: 0 kB",
  "MemTotal: 8 kB\nMemAvailable: 9 kB",
])("rejects incomplete or invalid memory samples: %s", (value) => {
  expect(parseMemoryCapacity(value)).toBeNull();
});
it("reports filesystem capacity available to ordinary users, preserving independent failures", async () => {
  const disk = {
    type: 1,
    bsize: 4096,
    blocks: 1000,
    bfree: 300,
    bavail: 200,
    files: 100,
    ffree: 90,
  };
  const result = await collectMachineResources({
    memory: async () => {
      throw Error("unavailable");
    },
    disk: async () => disk,
  });
  expect(result).toEqual({ memory: null, disk: { totalBytes: 4096000, availableBytes: 819200 } });
  expect(
    await collectMachineResources({
      memory: async () => "MemTotal: 8000 kB\nMemAvailable: 3000 kB",
      disk: async () => {
        throw Error("no statfs");
      },
    }),
  ).toMatchObject({ memory: { totalBytes: 8192000 }, disk: null });
});
