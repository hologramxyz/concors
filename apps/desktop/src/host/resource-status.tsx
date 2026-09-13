import { useEffect, useState } from "react";
import { Activity, TriangleAlert } from "lucide-react";
import type { ConnectionState, DaemonConnection } from "@concors/daemon-client";
import { HOST_USAGE_CAPABILITY, type HostUsage } from "@concors/protocol";
import { HOST_USAGE_STALE_MS, usageSummary } from "./usage-display";

/** Kept outside the scrolling workspace so usage stays visible in settings and collapsed layouts. */
export function ResourceStatus({
  connection,
  state,
  machine,
  compact = false,
}: {
  connection: DaemonConnection | null;
  state: ConnectionState;
  machine: string;
  compact?: boolean;
}) {
  const [reading, setReading] = useState<{
    connection: DaemonConnection;
    usage: HostUsage | null;
    receivedAt: number;
  } | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!connection) return;
    const unsubscribe = connection.subscribeHostUsage((usage) => {
      const receivedAt = Date.now();
      setReading({ connection, usage, receivedAt });
      setNow(receivedAt);
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [connection]);

  const current = reading?.connection === connection ? reading : null;
  const stale = !!current?.usage && now - current.receivedAt >= HOST_USAGE_STALE_MS;
  const status =
    state.status !== "ready"
      ? state.status === "connecting" || state.status === "handshaking"
        ? "Connecting…"
        : "Offline"
      : !state.daemon.capabilities?.includes(HOST_USAGE_CAPABILITY)
        ? "Update daemon for usage"
        : stale
          ? "Usage stale"
          : !current?.usage
            ? !current || now - current.receivedAt < HOST_USAGE_STALE_MS
              ? "Checking usage…"
              : "Usage unavailable"
            : null;
  const usage = status ? null : current?.usage;
  const summary = usage ? usageSummary(usage) : null;
  const high = summary?.highCpu || summary?.highMemory;

  return (
    <div
      role="group"
      aria-label="Machine resource usage"
      data-usage-status={status ?? "live"}
      className={
        compact
          ? "mt-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground"
          : "flex min-h-7 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/20 px-3 py-1 text-[11px] text-muted-foreground"
      }
    >
      <span className={compact ? "sr-only" : "flex max-w-40 min-w-0 items-center gap-1.5"}>
        <Activity className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{machine}</span>
      </span>
      <span className={`shrink-0 tabular-nums ${summary?.highCpu ? "text-destructive" : ""}`}>
        CPU {summary?.cpu ?? "—"}
      </span>
      <span className={`shrink-0 tabular-nums ${summary?.highMemory ? "text-destructive" : ""}`}>
        RAM{" "}
        {summary
          ? compact
            ? summary.memory
            : `${summary.memory} (${summary.memoryPercent})`
          : "—"}
      </span>
      {high && (
        <span className="flex items-center gap-1 text-destructive">
          <TriangleAlert className="size-3" aria-hidden="true" />
          High usage
        </span>
      )}
      {status && <span>{status}</span>}
    </div>
  );
}
