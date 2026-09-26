import { useRef, useState } from "react";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { newRequestId } from "@concors/client-core";
import {
  PREVIEW_NAME_MAX,
  PREVIEW_NAMES_CAPABILITY,
  RESOURCES_CAPABILITY,
  type MachineProcess,
} from "@concors/protocol";
import { SidebarEmpty, SidebarSection } from "@/components/sidebar-section";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openPreview } from "@/tauri/open-external";
import { discoveredPreviews, type DiscoveredPreview } from "./discovered-previews";
import { StopProcessDialog } from "./stop-process-dialog";
import { useProcesses } from "./use-processes";

export function PreviewsSidebar({ compact = false }: { compact?: boolean }) {
  const { connection, snapshot, loading, refresh } = useProcesses();
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<MachineProcess | null>(null);
  const [renaming, setRenamingState] = useState<{ id: string; value: string } | null>(null);
  // Mirrors `renaming` so the blur that follows Enter or Escape cannot commit a second time.
  const renamingRef = useRef(renaming);
  const setRenaming = (next: typeof renaming) => {
    renamingRef.current = next;
    setRenamingState(next);
  };
  const capabilities =
    connection?.state.status === "ready" ? connection.state.daemon.capabilities : [];
  const supported = !!capabilities?.includes(RESOURCES_CAPABILITY);
  const renamable = !!capabilities?.includes(PREVIEW_NAMES_CAPABILITY);
  const items = connection ? discoveredPreviews(snapshot?.processes ?? [], connection) : [];
  const open = (preview: DiscoveredPreview) => {
    setError(null);
    void openPreview(preview.preview, preview.url).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not open preview.");
    });
  };
  const commitRename = (preview: DiscoveredPreview) => {
    const current = renamingRef.current;
    if (!current || current.id !== preview.id) return;
    setRenaming(null);
    const name = current.value.trim();
    if (!connection || name === preview.name) return;
    setError(null);
    // A blank name returns the preview to the agent's name, or the process's.
    void connection
      .requestResource(
        { kind: "rename-preview", id: preview.process.id, port: preview.port, name },
        newRequestId(),
      )
      .then((result) => {
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        return refresh();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not rename preview.");
      });
  };
  const actionClass =
    "rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-sidebar-foreground disabled:hidden [@media(hover:none)]:opacity-100";
  const list = (
    <ul className="mt-1 space-y-0.5">
      {items.map((preview) => (
        <li key={preview.id} className="group flex min-w-0 items-center">
          {!compact && renaming?.id === preview.id ? (
            <input
              aria-label="Preview name"
              autoFocus
              value={renaming.value}
              maxLength={PREVIEW_NAME_MAX}
              placeholder="Automatic name"
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setRenaming({ id: preview.id, value: event.target.value })}
              onBlur={() => commitRename(preview)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename(preview);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setRenaming(null);
                }
              }}
              className="mx-1 my-0.5 min-w-0 flex-1 rounded bg-background px-2 py-1 ring-1 ring-ring outline-none"
            />
          ) : (
            <SidebarTooltip collapsed={compact}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Open preview: ${preview.name}`}
                  onClick={() => open(preview)}
                  className={
                    compact
                      ? "sidebar-rail-control flex items-center justify-center rounded-md hover:bg-sidebar-accent"
                      : "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
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
          )}
          {!compact && renaming?.id !== preview.id && (
            <>
              <button
                type="button"
                aria-label={`Rename ${preview.name}`}
                title="Rename"
                disabled={!renamable}
                onClick={() => {
                  setError(null);
                  setRenaming({ id: preview.id, value: preview.name });
                }}
                className={actionClass}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Stop ${preview.name}`}
                title={preview.process.stopBlocked ?? "Stop"}
                disabled={!supported || !!preview.process.stopBlocked}
                onClick={() => {
                  setError(null);
                  setStopping(preview.process);
                }}
                className={actionClass}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
  const dialog = (
    <StopProcessDialog
      connection={connection}
      process={stopping}
      supported={supported}
      onClose={() => setStopping(null)}
      onStopped={() => {
        setStopping(null);
        void refresh();
      }}
    />
  );
  if (compact) return items.length ? <section aria-label="Previews">{list}</section> : null;
  return (
    <SidebarSection title="Previews">
      {dialog}
      {items.length ? list : null}
      {!items.length && (
        <SidebarEmpty>{loading ? "Discovering previews…" : "No previews detected."}</SidebarEmpty>
      )}
      {error && <SidebarEmpty tone="alert">{error}</SidebarEmpty>}
    </SidebarSection>
  );
}
