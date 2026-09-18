import type { Machine } from "@concors/api-client";
import { useEffect, useState } from "react";
import { formatResourceBytes, resourceFreshness, usagePercent } from "./resource-usage.ts";

export function MachineUsage({ machine }: { readonly machine: Machine }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const freshness = resourceFreshness(machine, now);
  const usage = machine.resourceUsage;
  if (freshness === "unavailable" || !usage)
    return (
      <p className="text-xs text-muted-foreground">
        Usage unavailable · waiting for a resource report
      </p>
    );
  return (
    <section aria-label={`${machine.name} resource usage`} className="flex min-w-0 flex-col">
      <div className="grid gap-4 sm:grid-cols-2">
        {(["memory", "disk"] as const).map((kind) => {
          const value = usage[kind];
          const label = kind === "memory" ? "Memory" : "Disk";
          const percent = value ? usagePercent(value) : null;
          return (
            <div key={kind}>
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium tabular-nums">
                  {percent === null ? "Unavailable" : `${percent}%`}
                </span>
              </div>
              {value && (
                <>
                  <div
                    role="meter"
                    aria-label={`${label} usage`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent ?? 0}
                    aria-valuetext={`${percent}%${freshness === "stale" ? ", last reported" : ""}`}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={
                        freshness === "stale"
                          ? "h-full rounded-full bg-muted-foreground/40"
                          : "h-full rounded-full bg-primary/70"
                      }
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                    {formatResourceBytes(value.totalBytes - value.availableBytes)} /{" "}
                    {formatResourceBytes(value.totalBytes)} used
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-auto pt-4 text-right text-[11px] text-muted-foreground/70">
        {freshness === "stale" ? "Out of date · last updated " : "Updated "}
        <time dateTime={usage.sampledAt} title={new Date(usage.sampledAt).toLocaleString()}>
          {new Date(usage.sampledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      </p>
    </section>
  );
}
