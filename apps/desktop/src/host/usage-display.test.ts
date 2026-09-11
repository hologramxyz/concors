import { expect, it } from "vitest";
import { formatMemory, usageSummary } from "./usage-display";

it("formats memory with explicit binary units", () => {
  expect(formatMemory(0)).toBe("0 B");
  expect(formatMemory(1024)).toBe("1.0 KiB");
  expect(formatMemory(1024 ** 2)).toBe("1.0 MiB");
  expect(formatMemory(1.5 * 1024 ** 3)).toBe("1.5 GiB");
});
it("distinguishes an unknown CPU reading from zero and warns at 90 percent", () => {
  const usage = {
    sampledAt: 1,
    cpuPercent: null,
    cpuCount: 4,
    memory: { usedBytes: 9, totalBytes: 10 },
  };
  expect(usageSummary(usage)).toMatchObject({
    cpu: "—",
    highCpu: false,
    highMemory: true,
    memoryPercent: "90%",
  });
  expect(usageSummary({ ...usage, cpuPercent: 0 }).cpu).toBe("0%");
  expect(usageSummary({ ...usage, cpuPercent: 89.9 }).highCpu).toBe(false);
  expect(usageSummary({ ...usage, cpuPercent: 90 }).highCpu).toBe(true);
});
