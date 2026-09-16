import { useContext, useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { newRequestId } from "@concors/client-core";
import { ContextMenu } from "radix-ui";
import { SidebarSection } from "@/components/sidebar-section";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { CompactLayoutContext } from "@/components/compact-layout";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { openExternal } from "@/tauri/open-external";
import { usePreviewLinks, type PreviewLink } from "./preview-links";
import { PreviewEditor } from "./preview-editor";

export function PreviewsSidebar({ compact = false }: { compact?: boolean }) {
  const connection = useContext(TerminalConnectionContext);
  const { links, setLink, removeLink } = usePreviewLinks(connection);
  const touchLayout = useContext(CompactLayoutContext);
  const [editor, setEditor] = useState<{ connection: typeof connection; id: string } | null>(null);
  const [error, setError] = useState<{ connection: typeof connection; message: string } | null>(
    null,
  );
  const items = Object.entries(links);
  const open = (preview: PreviewLink) => {
    setError(null);
    void openExternal(preview.url).catch((cause: unknown) => {
      setError({
        connection,
        message: cause instanceof Error ? cause.message : "Could not open preview.",
      });
    });
  };
  const list = (
    <ul className="mt-1 space-y-0.5">
      {items.map(([id, preview]) => (
        <li key={id}>
          <ContextMenu.Root>
            <SidebarTooltip collapsed={compact}>
              <TooltipTrigger asChild>
                <ContextMenu.Trigger asChild>
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
                </ContextMenu.Trigger>
              </TooltipTrigger>
              <TooltipContent side="right">
                {preview.name} · {preview.url}
              </TooltipContent>
            </SidebarTooltip>
            <ContextMenu.Portal>
              <ContextMenu.Content className="z-50 min-w-40 rounded-lg bg-popover p-1 text-ui text-popover-foreground shadow-md ring-1 ring-foreground/10">
                <ContextMenu.Item
                  className="flex min-h-[40px] cursor-pointer items-center rounded-md px-3 outline-none focus:bg-accent"
                  onSelect={() => setEditor({ connection, id })}
                >
                  Edit preview
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="flex min-h-[40px] cursor-pointer items-center rounded-md px-3 outline-none focus:bg-accent"
                  onSelect={() => removeLink(id)}
                >
                  Remove preview
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      {compact ? (
        items.length ? (
          <section aria-label="Previews">{list}</section>
        ) : null
      ) : (
        <SidebarSection
          title="Previews"
          action={
            <button
              type="button"
              aria-label="Add preview"
              disabled={!connection}
              onClick={() => setEditor({ connection, id: newRequestId() })}
              className={
                touchLayout
                  ? "mobile-icon"
                  : "rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-40"
              }
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          }
        >
          {list}
          {!items.length && (
            <p className="px-2 py-2 text-ui text-muted-foreground">No previews yet.</p>
          )}
          {error?.connection === connection && (
            <p role="alert" className="px-2 py-2 text-ui text-destructive">
              {error.message}
            </p>
          )}
        </SidebarSection>
      )}
      {editor?.connection === connection && (
        <PreviewEditor
          key={editor.id}
          name={links[editor.id]?.name ?? ""}
          url={links[editor.id]?.url ?? ""}
          {...(links[editor.id]
            ? {
                onRemove: () => {
                  removeLink(editor.id);
                  setEditor(null);
                },
              }
            : {})}
          onClose={() => setEditor(null)}
          onSave={(name, url) => {
            if (!connection) return;
            setLink(editor.id, url, name);
            setEditor(null);
          }}
        />
      )}
    </>
  );
}
