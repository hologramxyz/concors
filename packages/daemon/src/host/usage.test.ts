import { afterEach, describe, expect, it, vi } from "vitest";
import { availableMemory, createHostUsageMonitor, createHostUsageSampler } from "./usage.ts";

afterEach(() => vi.useRealTimers());
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    92167.
Pages active:                                 994333.
Pages inactive:                               990479.
Pages speculative:                             15005.
Pages throttled:                                   0.
Pages wired down:                             174490.
Pages purgeable:                               43218.
`;
const usage = {
  sampledAt: 100,
  cpuPercent: 25,
  cpuCount: 2,
  memory: { usedBytes: 4, totalBytes: 8 },
};

describe("machine measurements", () => {
  it("uses Linux available memory and safely falls back on other systems", () => {
    expect(availableMemory("MemFree: 1 kB\nMemAvailable: 6 kB\n", null, 1000, 8192)).toBe(6144);
    expect(availableMemory(null, null, 1000, 8192)).toBe(1000);
    expect(availableMemory("MemAvailable: broken kB", null, 1000, 8192)).toBe(1000);
    expect(availableMemory("MemAvailable: 900 kB", null, 1000, 8192)).toBe(8192);
    expect(availableMemory(null, null, -5, 8192)).toBe(0);
  });
  // os.freemem() on macOS counts only the free list, which the kernel keeps near empty on
  // purpose, so trusting it reports an idle machine as ~97% full.
  it("counts reclaimable macOS pages instead of the nearly empty free list", () => {
    const total = 36 * 1024 ** 3;
    expect(availableMemory(null, VM_STAT, 1.11 * 1024 ** 3, total)).toBe(
      (92167 + 990479 + 15005) * 16384,
    );
    // Roughly half the machine, not 97% of it.
    const used = total - availableMemory(null, VM_STAT, 1.11 * 1024 ** 3, total);
    expect(Math.round((used / total) * 100)).toBe(53);
  });
  it("falls back rather than guessing when vm_stat output is unusable", () => {
    expect(availableMemory(null, "not vm_stat output", 1000, 8192)).toBe(1000);
    expect(availableMemory(null, "page size of 0 bytes\nPages free: 1.\n", 1000, 8192)).toBe(1000);
    // A future macOS that drops a counter must not be read as a nearly empty machine.
    expect(availableMemory(null, "page size of 4096 bytes\nPages free:  2.\n", 1000, 8192)).toBe(
      1000,
    );
  });
  it("prefers Linux meminfo when both are somehow present", () => {
    expect(availableMemory("MemAvailable: 6 kB", VM_STAT, 1000, 8192)).toBe(6144);
  });
  it("measures CPU deltas across cores, not load averages or process usage", async () => {
    let times = { user: 100, nice: 0, sys: 0, irq: 0, idle: 100 };
    const read = {
      cpus: () => [{ times }, { times }],
      totalmem: () => 8192,
      freemem: () => 1000,
      meminfo: async () => "MemAvailable: 6 kB",
      vmstat: async () => null,
      now: () => 100,
    };
    const sample = createHostUsageSampler(read);
    expect(await sample()).toEqual({
      sampledAt: 100,
      cpuPercent: null,
      cpuCount: 2,
      memory: { usedBytes: 2048, totalBytes: 8192 },
    });
    times = { ...times, user: 125, idle: 175 };
    expect((await sample()).cpuPercent).toBe(25);
    expect((await sample()).cpuPercent).toBeNull();
    times = { ...times, user: 0, idle: 0 };
    expect((await sample()).cpuPercent).toBeNull();
  });
  it("handles missing CPU information without inventing zero usage", async () => {
    const sample = createHostUsageSampler({
      cpus: () => [],
      totalmem: () => 8,
      freemem: () => 3,
      meminfo: async () => null,
      vmstat: async () => null,
      now: () => 1,
    });
    expect((await sample()).cpuPercent).toBeNull();
    expect((await sample()).memory.usedBytes).toBe(5);
  });
});

describe("shared resource monitor", () => {
  it("samples once for multiple viewers and stops after the last unsubscribe", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => usage);
    const monitor = createHostUsageMonitor(() => read);
    expect(read).not.toHaveBeenCalled();
    const first = vi.fn(),
      second = vi.fn();
    const offFirst = monitor.subscribe(first);
    await vi.advanceTimersByTimeAsync(0);
    const offSecond = monitor.subscribe(second);
    expect(first).toHaveBeenCalledWith(usage);
    expect(second).toHaveBeenCalledWith(usage);
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(2);
    offFirst();
    offSecond();
    await vi.advanceTimersByTimeAsync(4000);
    expect(read).toHaveBeenCalledTimes(2);
    monitor.close();
  });
  it("does not overlap slow reads or deliver them after shutdown", async () => {
    vi.useFakeTimers();
    let resolve!: (value: typeof usage) => void;
    const read = vi.fn(
      () =>
        new Promise<typeof usage>((done) => {
          resolve = done;
        }),
    );
    const monitor = createHostUsageMonitor(() => read);
    const listener = vi.fn();
    monitor.subscribe(listener);
    await vi.advanceTimersByTimeAsync(6000);
    expect(read).toHaveBeenCalledTimes(1);
    monitor.close();
    resolve(usage);
    await vi.advanceTimersByTimeAsync(6000);
    expect(listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reports failures as unavailable and retries", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(usage);
    const monitor = createHostUsageMonitor(() => read);
    const listener = vi.fn();
    monitor.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(listener).toHaveBeenLastCalledWith(usage);
    monitor.close();
  });
});
