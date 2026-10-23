import type { DaemonConnection } from "@concors/daemon-client";
import type { MachineProcess, ProcessPreview } from "@concors/protocol";
import { formatMemory } from "./usage-display";

export interface DiscoveredPreview {
  id: string;
  name: string;
  port: number;
  preview: ProcessPreview;
  url: string;
  /** The listener, which stopping the preview stops. */
  process: MachineProcess;
}

type PreviewConnection = Pick<DaemonConnection, "previewUrl">;

export function discoveredPreviews(
  processes: readonly MachineProcess[],
  connection: PreviewConnection,
): DiscoveredPreview[] {
  const items = new Map<number, DiscoveredPreview>();
  for (const process of processes) {
    for (const preview of process.previews) {
      if (items.has(preview.port)) continue;
      const url = connection.previewUrl(preview);
      if (!url) continue;
      items.set(preview.port, {
        id: `${process.id}:${preview.port}`,
        name:
          preview.name ??
          (process.previews.length > 1 ? `${process.name} · :${preview.port}` : process.name),
        port: preview.port,
        preview,
        url,
        process,
      });
    }
  }
  return [...items.values()].sort((a, b) => a.port - b.port || a.name.localeCompare(b.name));
}

const DAY = 86_400_000;
/** A preview running this long, or holding this much memory (RAM and swap), is worth a look. */
export const OLD_PREVIEW_MS = 3 * DAY;
export const HEAVY_PREVIEW_BYTES = 1.5 * 1024 ** 3;

function duration(ms: number) {
  const [value, unit] =
    ms >= DAY
      ? [Math.floor(ms / DAY), "day"]
      : ms >= 3_600_000
        ? [Math.floor(ms / 3_600_000), "hour"]
        : [Math.max(1, Math.floor(ms / 60_000)), "minute"];
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

/**
 * How long a preview's server has run and how much memory it holds, swap included: a dev server an
 * agent left running can sit for weeks, pushed into swap where RAM figures no longer show it, until
 * the machine runs out. Nothing is stopped for anyone; `warning` says when one is worth a look.
 */
export function previewUsage(process: MachineProcess, now = Date.now()) {
  const age = process.startedAt ? Math.max(0, now - process.startedAt) : null;
  const ram = process.memoryBytes ?? 0;
  const swap = process.swapBytes ?? 0;
  const memory = process.memoryBytes === null && !process.swapBytes ? null : ram + swap;
  const details = [
    age === null ? null : `Running for ${duration(age)}`,
    memory === null
      ? null
      : `${formatMemory(memory)} of memory${swap ? ` (${formatMemory(swap)} in swap)` : ""}`,
  ].filter((part) => part !== null);
  const old = age !== null && age >= OLD_PREVIEW_MS;
  const heavy = memory !== null && memory >= HEAVY_PREVIEW_BYTES;
  const reasons = [
    old && age !== null ? `running for ${duration(age)}` : null,
    heavy && memory !== null
      ? `holding ${formatMemory(memory)} of memory${swap > ram ? ", most of it in swap" : ""}`
      : null,
  ].filter((part) => part !== null);
  const sentence = reasons.join(" and ");
  return {
    details,
    warning: sentence
      ? `${sentence[0]?.toUpperCase()}${sentence.slice(1)}. Stop it if you no longer need it.`
      : null,
  };
}
