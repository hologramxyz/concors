import { Activity, ExternalLink, SlidersHorizontal } from "lucide-react";
import { useContext } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { SidebarSection } from "@/components/sidebar-section";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMemory } from "./usage-display";
import { useProcesses } from "./use-processes";
import { usePreviewLinks } from "./preview-links";
import { openExternal } from "@/tauri/open-external";

export function ProcessesSidebar({
  compact = false,
  enabled = true,
  onOpen,
}: {
  compact?: boolean;
  enabled?: boolean;
  onOpen: () => void;
}) {
  const touchLayout = useContext(CompactLayoutContext);
  const { snapshot, error, loading, connection } = useProcesses(enabled);
  const { links } = usePreviewLinks(connection);
  const items = [...(snapshot?.processes ?? [])]
    .filter((p) => !p.stopBlocked)
    .sort(
      (a, b) =>
        Number(b.ports.length > 0) - Number(a.ports.length > 0) ||
        (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0),
    )
    .slice(0, 6);
  const list = (
    <ul className="mt-1 space-y-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <SidebarTooltip collapsed={compact}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  const url = links[item.id];
                  if (url) void openExternal(url).catch(onOpen);
                  else onOpen();
                }}
                className={
                  compact
                    ? "sidebar-rail-control relative flex items-center justify-center rounded-md hover:bg-sidebar-accent"
                    : "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
                }
                aria-label={
                  compact
                    ? `${item.name}, ${item.state}, ${item.memoryBytes === null ? "RAM unknown" : formatMemory(item.memoryBytes)}`
                    : undefined
                }
              >
                {item.ports.length ? (
                  <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Activity className="size-4 shrink-0 text-muted-foreground" />
                )}
                {!compact && (
                  <>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      {item.ports.length
                        ? `:${item.ports[0]}`
                        : item.memoryBytes === null
                          ? "—"
                          : formatMemory(item.memoryBytes)}
                    </span>
                  </>
                )}
                <span
                  className={`size-1.5 shrink-0 rounded-full ${compact ? "absolute right-1 bottom-1" : ""} ${item.state === "running" ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {item.name} · {item.state}
            </TooltipContent>
          </SidebarTooltip>
        </li>
      ))}
    </ul>
  );
  if (compact) return items.length ? <section aria-label="Processes">{list}</section> : null;
  return (
    <SidebarSection
      title="Processes"
      action={
        <button
          type="button"
          onClick={onOpen}
          aria-label="Manage processes"
          className={
            touchLayout
              ? "mobile-icon"
              : "rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          }
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
        </button>
      }
    >
      {list}
      {!items.length && (
        <p className="px-2 py-2 text-ui leading-relaxed text-muted-foreground">
          {loading
            ? "Discovering processes…"
            : error
              ? "Open Resources to inspect this machine."
              : "No workspace processes discovered."}
        </p>
      )}
    </SidebarSection>
  );
}
