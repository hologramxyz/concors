import type { DaemonConnection } from "@concors/daemon-client";
import type { MachineProcess, ProcessPreview } from "@concors/protocol";

export interface DiscoveredPreview {
  id: string;
  name: string;
  port: number;
  preview: ProcessPreview;
  url: string;
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
        name: process.previews.length > 1 ? `${process.name} · :${preview.port}` : process.name,
        port: preview.port,
        preview,
        url,
      });
    }
  }
  return [...items.values()].sort((a, b) => a.port - b.port || a.name.localeCompare(b.name));
}
