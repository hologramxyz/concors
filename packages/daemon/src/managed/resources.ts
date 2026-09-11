import { readFile, statfs } from "node:fs/promises";

export interface ResourceCapacity {
  totalBytes: number;
  availableBytes: number;
}
export interface MachineResources {
  memory: ResourceCapacity | null;
  disk: ResourceCapacity | null;
}

function capacity(totalBytes: number, availableBytes: number): ResourceCapacity | null {
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes <= 0 ||
    !Number.isSafeInteger(availableBytes) ||
    availableBytes < 0 ||
    availableBytes > totalBytes
  )
    return null;
  return { totalBytes, availableBytes };
}

/** MemAvailable includes reclaimable caches; MemFree alone overstates Linux RAM usage. */
export function parseMemoryCapacity(meminfo: string): ResourceCapacity | null {
  const total = /^MemTotal:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
  const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
  return total && available ? capacity(Number(total) * 1024, Number(available) * 1024) : null;
}

/** Root filesystem headroom available to the unprivileged daemon/workspace user. */
export async function collectMachineResources(
  sources = {
    memory: () => readFile("/proc/meminfo", "utf8"),
    disk: () => statfs("/"),
  },
): Promise<MachineResources> {
  const [memory, disk] = await Promise.all([
    sources
      .memory()
      .then(parseMemoryCapacity)
      .catch(() => null),
    sources
      .disk()
      .then((s) => capacity(s.blocks * s.bsize, Math.max(0, s.bavail) * s.bsize))
      .catch(() => null),
  ]);
  return { memory, disk };
}
