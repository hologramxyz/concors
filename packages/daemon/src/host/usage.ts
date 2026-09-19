import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import { promisify } from "node:util";
import { HOST_USAGE_INTERVAL_MS, type HostUsage } from "@concors/protocol";

const run = promisify(execFile);

interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}
interface UsageSource {
  cpus(): readonly { times: CpuTimes }[];
  totalmem(): number;
  freemem(): number;
  meminfo(): Promise<string | null>;
  vmstat(): Promise<string | null>;
  now(): number;
}
const source: UsageSource = {
  cpus,
  totalmem,
  freemem,
  meminfo: () =>
    process.platform === "linux"
      ? readFile("/proc/meminfo", "utf8").catch(() => null)
      : Promise.resolve(null),
  vmstat: () =>
    process.platform === "darwin"
      ? run("vm_stat", [], { timeout: 2000 })
          .then(({ stdout }) => stdout)
          .catch(() => null)
      : Promise.resolve(null),
  now: Date.now,
};

/** Linux's MemAvailable includes reclaimable cache, unlike MemFree. */
function memAvailable(meminfo: string | null): number | null {
  const match = meminfo?.match(/^MemAvailable:\s+(\d+)\s+kB\s*$/m);
  return match ? Number(match[1]) * 1024 : null;
}

/**
 * macOS keeps almost nothing in the free list on purpose — spare memory holds evictable file cache
 * instead — so `os.freemem()` reports a healthy machine as nearly full. Counting the pages the
 * kernel can hand back on demand is the equivalent of Linux's MemAvailable. Purgeable pages are
 * deliberately excluded: they are already counted in the active and inactive lists.
 */
function vmStatAvailable(vmstat: string | null): number | null {
  if (!vmstat) return null;
  const pageSize = Number(vmstat.match(/page size of (\d+) bytes/)?.[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
  let pages = 0;
  for (const name of ["free", "inactive", "speculative"]) {
    const match = vmstat.match(new RegExp(`^Pages ${name}:\\s+(\\d+)\\.?\\s*$`, "m"));
    if (!match) return null;
    pages += Number(match[1]);
  }
  return Number.isFinite(pages) ? pages * pageSize : null;
}

/** Both platforms report reclaimable cache as available; only their free counters omit it. */
export function availableMemory(
  meminfo: string | null,
  vmstat: string | null,
  fallback: number,
  total: number,
): number {
  const available = memAvailable(meminfo) ?? vmStatAvailable(vmstat) ?? fallback;
  return Math.max(0, Math.min(total, Number.isFinite(available) ? available : fallback));
}

/** Whole OS/VM, not the Node process, browser, or a container/service's individual quota. */
export function createHostUsageSampler(read: UsageSource = source): () => Promise<HostUsage> {
  let previous: { idle: number; total: number; count: number } | null = null;
  return async () => {
    const processors = read.cpus();
    const current = processors.reduce(
      (sum, { times }) => ({
        idle: sum.idle + times.idle,
        total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq,
        count: sum.count + 1,
      }),
      { idle: 0, total: 0, count: 0 },
    );
    let cpuPercent: number | null = null;
    if (previous && current.count === previous.count && current.count > 0) {
      const total = current.total - previous.total;
      const idle = current.idle - previous.idle;
      if (total > 0 && idle >= 0 && idle <= total)
        cpuPercent = Math.round((1 - idle / total) * 1000) / 10;
    }
    previous = current;
    const totalBytes = read.totalmem();
    const [meminfo, vmstat] = await Promise.all([read.meminfo(), read.vmstat()]);
    const available = availableMemory(meminfo, vmstat, read.freemem(), totalBytes);
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || !Number.isFinite(available))
      throw new Error("System memory information unavailable");
    return {
      sampledAt: read.now(),
      cpuPercent,
      cpuCount: current.count,
      memory: { usedBytes: Math.round(totalBytes - available), totalBytes },
    };
  };
}

export interface HostUsageMonitor {
  subscribe(listener: (usage: HostUsage | null) => void): () => void;
  close(): void;
}

/** One lightweight sampler for all viewers; no polling without subscribers or overlapping reads. */
export function createHostUsageMonitor(
  createSampler = createHostUsageSampler,
  intervalMs = HOST_USAGE_INTERVAL_MS,
): HostUsageMonitor {
  const listeners = new Set<(usage: HostUsage | null) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let latest: HostUsage | null = null;
  let closed = false;
  const stop = () => {
    generation++;
    clearTimeout(timer);
    latest = null;
  };
  return {
    subscribe(listener) {
      if (closed) return () => undefined;
      listeners.add(listener);
      if (listeners.size === 1) {
        const epoch = ++generation;
        const sample = createSampler();
        const poll = async () => {
          const usage = await sample().catch(() => null);
          if (generation !== epoch || !listeners.size) return;
          latest = usage;
          for (const notify of listeners) notify(usage);
          if (generation === epoch && listeners.size) {
            timer = setTimeout(() => void poll(), intervalMs);
            timer.unref();
          }
        };
        void poll();
      } else if (latest) listener(latest);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) stop();
      };
    },
    close() {
      closed = true;
      listeners.clear();
      stop();
    },
  };
}
