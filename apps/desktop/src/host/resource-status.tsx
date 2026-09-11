import { useEffect, useState } from "react";
import { Activity, TriangleAlert } from "lucide-react";
import type { ConnectionState, DaemonConnection } from "@concors/daemon-client";
import { HOST_USAGE_CAPABILITY, type HostUsage } from "@concors/protocol";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HOST_USAGE_STALE_MS, usageSummary } from "./usage-display";

/** Kept outside the scrolling workspace so usage stays visible in settings and collapsed layouts. */
export function ResourceStatus({
  connection,
  state,
  machine,
}: {
  connection: DaemonConnection | null;
  state: ConnectionState;
  machine: string;
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
            ? "Usage unavailable"
            : null;
  const usage = status ? null : current?.usage;
  const summary = usage ? usageSummary(usage) : null;
  const high = summary?.highCpu || summary?.highMemory;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="group"
          aria-label="Machine resource usage"
          tabIndex={0}
          data-usage-status={status ?? "live"}
          className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/20 px-3 py-1 text-[11px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="flex max-w-40 min-w-0 items-center gap-1.5" title={machine}>
            <Activity className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{machine}</span>
          </span>
          <span className={`shrink-0 tabular-nums ${summary?.highCpu ? "text-destructive" : ""}`}>
            CPU {summary?.cpu ?? "—"}
          </span>
          <span
            className={`shrink-0 tabular-nums ${summary?.highMemory ? "text-destructive" : ""}`}
          >
            RAM {summary ? `${summary.memory} (${summary.memoryPercent})` : "—"}
          </span>
          {high && (
            <span className="flex items-center gap-1 text-destructive">
              <TriangleAlert className="size-3" aria-hidden="true" />
              High usage
            </span>
          )}
          {status && <span>{status}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm flex-col items-start gap-1">
        <p className="font-medium">{machine} · whole-machine usage</p>
        <p>
          CPU and RAM reported by the connected daemon, not this browser. Refreshes every 2 seconds.
        </p>
        {usage && (
          <p>
            {usage.cpuCount} logical CPUs.{" "}
            {usage.cpuPercent === null
              ? "CPU usage is warming up or unavailable."
              : "CPU is averaged across all logical CPUs."}
          </p>
        )}
        <p>
          Linux RAM excludes available, reclaimable memory. Container and service quotas may be
          lower than machine totals.
        </p>
        {high && <p>CPU or RAM is at least 90% utilized. Consider reducing active workloads.</p>}
        {status && (
          <p>
            {status === "Usage stale"
              ? "No new reading for 10 seconds. Old values are hidden until telemetry resumes."
              : status === "Update daemon for usage"
                ? "This daemon does not support resource usage yet. Update the daemon on this machine."
                : status}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
