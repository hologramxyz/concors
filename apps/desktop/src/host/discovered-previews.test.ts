import { expect, it } from "vitest";
import type { MachineProcess } from "@concors/protocol";
import { discoveredPreviews } from "./discovered-previews";

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
      name: "Vite · :5173",
      port: 5173,
      preview: { port: 5173, protocol: "http" },
      url: "http://127.0.0.1:5173/",
      process,
    },
    {
      id: "10:20:5174",
      name: "Vite · :5174",
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
