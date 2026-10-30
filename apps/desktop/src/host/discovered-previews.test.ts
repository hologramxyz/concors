import { expect, it } from "vitest";
import type { MachineProcess } from "@concors/protocol";
import { discoveredPreviews, previewUsage } from "./discovered-previews";

const process: MachineProcess = {
  id: "10:20",
  pid: 10,
  parentPid: 1,
  name: "Vite",
  directory: "/repo",
  projectId: null,
  cpuPercent: 1,
  memoryBytes: 100,
  state: "sleeping",
  ports: [5173, 5174],
  previews: [
    { port: 5173, protocol: "http" },
    { port: 5174, protocol: "https" },
  ],
  stopBlocked: null,
};

it("deduplicates shared ports and labels processes with multiple previews", () => {
  expect(
    discoveredPreviews([process, { ...process, id: "11:20", name: "Child" }], {
      previewUrl: (preview) => `${preview.protocol}://127.0.0.1:${preview.port}/`,
    }),
  ).toEqual([
    {
      id: "10:20:5173",
      name: "Vite :5173",
      port: 5173,
      preview: { port: 5173, protocol: "http" },
      url: "http://127.0.0.1:5173/",
      process,
    },
    {
      id: "10:20:5174",
      name: "Vite :5174",
      port: 5174,
      preview: { port: 5174, protocol: "https" },
      url: "https://127.0.0.1:5174/",
      process,
    },
  ]);
});

it("prefers the name a person or agent gave the preview", () => {
  const named = {
    ...process,
    previews: [{ port: 5173, protocol: "http" as const, name: "Landing" }],
  };
  expect(
    discoveredPreviews([named], { previewUrl: () => "http://127.0.0.1:5173/" }).map((p) => p.name),
  ).toEqual(["Landing"]);
});

it("omits listeners when the selected connection cannot route their previews", () => {
  expect(discoveredPreviews([process], { previewUrl: () => null })).toEqual([]);
});

it("says how long a preview's server has run and what it holds, swap included", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  expect(
    previewUsage(
      { ...process, startedAt: now - 2 * 3_600_000, memoryBytes: 256 * 1024 ** 2, swapBytes: 0 },
      now,
    ),
  ).toEqual({ details: ["Running for 2 hours", "256.0 MiB of memory"], warning: null });
  // Older daemons send neither: nothing is guessed.
  expect(previewUsage({ ...process, memoryBytes: null }, now)).toEqual({
    details: [],
    warning: null,
  });
});

it("flags a preview left running for days or holding a lot of memory, and says which", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const day = 86_400_000;
  const old = previewUsage({ ...process, startedAt: now - 4 * day, memoryBytes: 1024 ** 2 }, now);
  expect(old.warning).toBe("Running for 4 days. Stop it if you no longer need it.");
  // Pushed into swap, a server's RAM looks small; what it holds still counts.
  const heavy = previewUsage(
    {
      ...process,
      startedAt: now - 3_600_000,
      memoryBytes: 40 * 1024 ** 2,
      swapBytes: 2 * 1024 ** 3,
    },
    now,
  );
  expect(heavy.details).toEqual(["Running for 1 hour", "2.0 GiB of memory (2.0 GiB in swap)"]);
  expect(heavy.warning).toBe(
    "Holding 2.0 GiB of memory, most of it in swap. Stop it if you no longer need it.",
  );
  expect(
    previewUsage(
      { ...process, startedAt: now - 22 * day, memoryBytes: 2 * 1024 ** 3, swapBytes: 0 },
      now,
    ).warning,
  ).toBe("Running for 22 days and holding 2.0 GiB of memory. Stop it if you no longer need it.");
});
