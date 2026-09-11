import { expect, it } from "vitest";
import { formatResourceBytes, resourceFreshness, usagePercent } from "./resource-usage.ts";

const now = Date.parse("2026-09-11T12:00:00Z");
const resourceUsage = {
  sampledAt: new Date(now).toISOString(),
  memory: { totalBytes: 8 * 1024 ** 3, availableBytes: 3 * 1024 ** 3 },
  disk: null,
};
it("formats available capacity and calculates usage", () => {
  expect(usagePercent(resourceUsage.memory)).toBe(63);
  expect(formatResourceBytes(resourceUsage.memory.totalBytes)).toBe("8.0 GiB");
  expect(formatResourceBytes(512 * 1024 ** 2)).toBe("512 MiB");
  expect(usagePercent({ totalBytes: 100, availableBytes: 0 })).toBe(100);
});
it("distinguishes missing, partial, stale, and stopped-machine samples", () => {
  expect(resourceFreshness({ status: "running" }, now)).toBe("unavailable");
  expect(
    resourceFreshness(
      { status: "running", resourceUsage: { ...resourceUsage, memory: null } },
      now,
    ),
  ).toBe("unavailable");
  expect(resourceFreshness({ status: "running", resourceUsage }, now + 89999)).toBe("fresh");
  expect(resourceFreshness({ status: "running", resourceUsage }, now + 90000)).toBe("stale");
  expect(resourceFreshness({ status: "stopped", resourceUsage }, now)).toBe("stale");
  expect(resourceFreshness({ status: "running", resourceUsage }, now - 10000)).toBe("stale");
});
