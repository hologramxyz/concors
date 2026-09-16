import { expect, it } from "vitest";
import { ResourceRequestSchema, ProcessSnapshotSchema } from "./resources.ts";

it("accepts explicit resource operations but never a raw cleanup path", () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  expect(
    ResourceRequestSchema.safeParse({
      type: "resource.request",
      requestId,
      operation: { kind: "processes" },
    }).success,
  ).toBe(true);
  expect(
    ResourceRequestSchema.safeParse({
      type: "resource.request",
      requestId,
      operation: { kind: "cleanup", path: "/tmp" },
    }).success,
  ).toBe(false);
  expect(
    ResourceRequestSchema.safeParse({
      type: "resource.request",
      requestId,
      operation: { kind: "cleanup", id: requestId },
    }).success,
  ).toBe(false);
});

it("bounds process inventories and treats unknown measurements as null", () => {
  const snapshot = {
    sampledAt: 1,
    warnings: [],
    processes: [
      {
        id: "1:2",
        pid: 1,
        parentPid: 0,
        name: "test",
        directory: null,
        projectId: null,
        cpuPercent: null,
        memoryBytes: null,
        state: "unknown",
        ports: [],
        stopBlocked: "Protected",
      },
    ],
  };
  expect(ProcessSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(
    ProcessSnapshotSchema.safeParse({
      ...snapshot,
      processes: Array(4097).fill(snapshot.processes[0]),
    }).success,
  ).toBe(false);
});
