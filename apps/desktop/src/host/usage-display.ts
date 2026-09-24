import type { HostUsage } from "@concors/protocol";

export const HOST_USAGE_STALE_MS = 10_000;
export const HIGH_USAGE_PERCENT = 90;

export function formatMemory(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const power = Math.min(
    units.length - 1,
    Math.max(0, Math.floor(Math.log2(Math.max(1, bytes)) / 10)),
  );
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

export function usageSummary(usage: HostUsage) {
  const memoryPercent = (usage.memory.usedBytes / usage.memory.totalBytes) * 100;
  return {
    cpu: usage.cpuPercent === null ? "—" : `${Math.round(usage.cpuPercent)}%`,
    memory: `${formatMemory(usage.memory.usedBytes)} / ${formatMemory(usage.memory.totalBytes)}`,
    memoryPercent: `${Math.round(memoryPercent)}%`,
    highCpu: usage.cpuPercent !== null && usage.cpuPercent >= HIGH_USAGE_PERCENT,
    highMemory: memoryPercent >= HIGH_USAGE_PERCENT,
  };
}

/** The dot before the machine name: whether the daemon is reachable right now. */
export function connectionIndicator(
  status: "disconnected" | "connecting" | "handshaking" | "ready" | "error",
  reconnecting: boolean,
) {
  if (status === "ready") return { label: "Online", color: "bg-emerald-500" };
  if (reconnecting) return { label: "Reconnecting", color: "bg-amber-500" };
  if (status === "connecting" || status === "handshaking")
    return { label: "Connecting", color: "bg-amber-500" };
  return { label: "Offline", color: "bg-red-500" };
}
