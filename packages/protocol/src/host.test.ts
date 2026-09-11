import { describe, expect, it } from "vitest";
import { HostUsageSchema, parseClientMessage, parseDaemonMessage } from "./index.ts";

const usage = {
  sampledAt: 1,
  cpuPercent: 32.5,
  cpuCount: 2,
  memory: { usedBytes: 4, totalBytes: 8 },
};

describe("host usage protocol", () => {
  it("supports opt-in subscriptions, warm-up and unavailable readings", () => {
    for (const enabled of [true, false])
      expect(parseClientMessage({ type: "host.subscribe", enabled }).success).toBe(true);
    for (const reading of [usage, { ...usage, cpuPercent: null }, null])
      expect(parseDaemonMessage({ type: "host.usage", usage: reading }).success).toBe(true);
    expect(parseClientMessage({ type: "host.subscribe" }).success).toBe(false);
  });
  it("rejects impossible or non-finite measurements", () => {
    for (const cpuPercent of [-1, 101, NaN, Infinity])
      expect(HostUsageSchema.safeParse({ ...usage, cpuPercent }).success).toBe(false);
    for (const memory of [
      { usedBytes: 9, totalBytes: 8 },
      { usedBytes: -1, totalBytes: 8 },
      { usedBytes: 0, totalBytes: 0 },
    ])
      expect(HostUsageSchema.safeParse({ ...usage, memory }).success).toBe(false);
  });
});
