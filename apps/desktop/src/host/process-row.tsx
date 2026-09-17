import { Activity, ChevronRight, ExternalLink, Square } from "lucide-react";
import type { MachineProcess } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { formatMemory } from "./usage-display";

/** Keep the running list scannable; maintenance actions live behind a disclosure. */
export function ResourceProcessRow({
  item,
  canStop,
  onPreview,
  onStop,
}: {
  item: MachineProcess;
  canStop: boolean;
  onPreview: () => void;
  onStop: () => void;
}) {
  const Icon = item.previews.length ? ExternalLink : Activity;
  return (
    <li className="flex min-w-0 items-start gap-1 rounded-md hover:bg-muted/40">
      <details className="group/process min-w-0 flex-1">
        <summary
          aria-label={`Details for ${item.name} (PID ${item.pid})`}
          className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2 focus-visible:outline-2 focus-visible:outline-ring sm:min-h-9 [&::-webkit-details-marker]:hidden"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
          <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:flex sm:gap-3">
            <span className="block">
              {item.memoryBytes === null ? "—" : formatMemory(item.memoryBytes)} RAM
            </span>
            <span className="block sm:min-w-16">
              {item.cpuPercent === null ? "—" : `${item.cpuPercent.toFixed(1)}%`} CPU
            </span>
          </span>
          <span
            aria-label={item.state}
            className={`size-1.5 shrink-0 rounded-full ${item.state === "running" ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
          />
          <ChevronRight
            className="size-3 shrink-0 text-muted-foreground group-open/process:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-2 pr-2 pb-3 pl-8 text-xs text-muted-foreground">
          <p>
            PID {item.pid} · {item.state}
          </p>
          {item.directory && <p className="break-all">{item.directory}</p>}
          {item.stopBlocked && <p>{item.stopBlocked}</p>}
          <div className="flex flex-wrap gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Stop ${item.name} (PID ${item.pid})`}
              disabled={!!item.stopBlocked || !canStop}
              onClick={onStop}
            >
              <Square className="size-3.5" />
              Stop
            </Button>
          </div>
        </div>
      </details>
      {item.previews.length > 0 && (
        <Button variant="ghost" size="sm" className="mt-1" onClick={onPreview}>
          <ExternalLink />
          Preview
        </Button>
      )}
    </li>
  );
}
