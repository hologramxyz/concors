import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { SidebarEmpty, SidebarSection } from "@/components/sidebar-section";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openPreview } from "@/tauri/open-external";
import { discoveredPreviews, type DiscoveredPreview } from "./discovered-previews";
import { useProcesses } from "./use-processes";

export function PreviewsSidebar({ compact = false }: { compact?: boolean }) {
  const { connection, snapshot, loading } = useProcesses();
  const [error, setError] = useState<string | null>(null);
  const items = connection ? discoveredPreviews(snapshot?.processes ?? [], connection) : [];
  const open = (preview: DiscoveredPreview) => {
    setError(null);
    void openPreview(preview.preview, preview.url).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not open preview.");
    });
  };
  const list = (
    <ul className="mt-1 space-y-0.5">
      {items.map((preview) => (
        <li key={preview.id}>
          <SidebarTooltip collapsed={compact}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Open preview: ${preview.name}`}
                onClick={() => open(preview)}
                className={
                  compact
                    ? "sidebar-rail-control flex items-center justify-center rounded-md hover:bg-sidebar-accent"
                    : "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
                }
              >
                <ExternalLink
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                {!compact && <span className="min-w-0 flex-1 truncate">{preview.name}</span>}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {preview.name} · :{preview.port}
            </TooltipContent>
          </SidebarTooltip>
        </li>
      ))}
    </ul>
  );
  if (compact) return items.length ? <section aria-label="Previews">{list}</section> : null;
  return (
    <SidebarSection title="Previews">
      {items.length ? list : null}
      {!items.length && (
        <SidebarEmpty>{loading ? "Discovering previews…" : "No previews detected."}</SidebarEmpty>
      )}
      {error && <SidebarEmpty tone="alert">{error}</SidebarEmpty>}
    </SidebarSection>
  );
}
