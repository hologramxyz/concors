import { useRef, useState } from "react";
import { ExternalLink, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { newRequestId } from "@concors/client-core";
import {
  PREVIEW_NAME_MAX,
  PREVIEW_NAMES_CAPABILITY,
  RESOURCES_CAPABILITY,
  type MachineProcess,
} from "@concors/protocol";
import { SidebarEmpty, SidebarSection } from "@/components/sidebar-section";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openPreview } from "@/tauri/open-external";
import { discoveredPreviews, previewUsage, type DiscoveredPreview } from "./discovered-previews";
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
      {items.map((preview) => {
        const usage = previewUsage(preview.process);
        return (
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
              // How long it has run and what it holds show on hover, expanded or not.
              <Tooltip>
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
                    <span className="relative flex shrink-0">
                      <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
                      {compact && usage.warning && (
                        <span
                          aria-hidden="true"
                          className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500"
                        />
                      )}
                    </span>
                    {!compact && <span className="min-w-0 flex-1 truncate">{preview.name}</span>}
                  </button>
                </TooltipTrigger>
                {/* Above the row when expanded, so it never covers the row's Rename and Stop. */}
                <TooltipContent
                  side={compact ? "right" : "top"}
                  align={compact ? "center" : "start"}
                >
                  <p className="flex gap-2 font-medium">
                    <span>{preview.name}</span>
                    <span className="opacity-75">:{preview.port}</span>
                  </p>
                  {usage.details.map((detail) => (
                    <p key={detail} className="opacity-75">
                      {detail}
                    </p>
                  ))}
                  {compact && usage.warning && <p>{usage.warning}</p>}
                </TooltipContent>
              </Tooltip>
            )}
            {!compact && renaming?.id !== preview.id && usage.warning && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="img"
                    tabIndex={0}
                    aria-label={usage.warning}
                    data-preview-warning
                    className="mr-0.5 flex shrink-0 rounded p-1 text-amber-500 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <TriangleAlert className="size-3.5" aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-64">
                  {usage.warning}
                </TooltipContent>
              </Tooltip>
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
        );
      })}
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
