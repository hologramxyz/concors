import { useState } from "react";
import { useCommand } from "@/shortcuts/context";
import { Ellipsis, GitFork, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import type { WorkspaceOperation, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import type { MobileTarget } from "@concors/client-core";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { FormDialog } from "@/workspace/form-dialog";
import { Button } from "@/components/ui/button";
import { paneProfiles } from "@/workspace/tab-profiles";
import { useTerminalProfiles } from "@/terminal/profiles-context";
import { useAgents } from "@/agents/context";
import { chatName } from "@/agents/chat-actions";
import { DeleteChatDialog, type ChatToDelete } from "@/agents/chat-limit";
import { useChatMenu } from "./chat-menu-context";
import { tabPanes, type PaneNode } from "./selection";

export function WorkspaceActions({
  project,
  tab,
  pane,
  canEdit,
  execute,
  command,
  onSelect,
  selected = false,
  label,
  keyboard = false,
  showTrigger = true,
  sidebar = false,
  onComplete,
}: {
  project: WorkspaceProject;
  tab: WorkspaceTab;
  pane: PaneNode;
  canEdit: boolean;
  execute(operation: WorkspaceOperation): Promise<void>;
  command(operation: WorkspaceOperation): void;
  onSelect(target: MobileTarget): void;
  selected?: boolean;
  label: string;
  keyboard?: boolean;
  showTrigger?: boolean;
  /** Drawn as the sidebar's row menus are, rather than the Tabs sheet's. */
  sidebar?: boolean;
  onComplete?(): void;
}) {
  const profiles = useTerminalProfiles();
  const options = paneProfiles(profiles.profiles);
  const [rename, setRename] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The chat stays set while its dialog closes, so it can ease out under the same name.
  const [deleting, setDeleting] = useState<{ chat: ChatToDelete; open: boolean } | null>(null);
  // Desktop's chat row actions, offered when its sidebar would offer them for this tab's chat.
  const menu = useChatMenu();
  const chat = useAgents().find((agent) => agent.id === pane.sessionId);
  const onPin = menu?.pin(chat);
  const fork = menu?.fork(chat);
  // Only desktop tabs have saved names. Do not rename split siblings together.
  const canRename = tabPanes(tab).length === 1;
  const onDelete =
    menu?.canDelete && chat
      ? () => setDeleting({ chat: { id: chat.id, name: chatName(chat) }, open: true })
      : undefined;
  const target = {
    projectId: project.id,
    expectedVersion: project.version,
    tabId: tab.id,
    paneId: pane.id,
  };
  // Both shortcut spellings close only the visible leaf on mobile, never its siblings.
  useCommand("close-pane", canEdit && keyboard, () => setClosing(true));
  useCommand("close-tab", canEdit && keyboard, () => setClosing(true));
  return (
    <>
      {showTrigger && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={
              sidebar
                ? "mobile-tap-target mr-1 flex items-center justify-center rounded p-1 text-muted-foreground hover:text-sidebar-foreground"
                : "mobile-icon mobile-row-actions"
            }
            aria-label={label}
          >
            <Ellipsis className={sidebar ? "size-4" : undefined} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {onPin && (
              <DropdownMenuItem onSelect={onPin}>
                {chat?.pinned ? (
                  <>
                    <PinOff />
                    Unpin
                  </>
                ) : (
                  <>
                    <Pin />
                    Pin
                  </>
                )}
              </DropdownMenuItem>
            )}
            {canRename && (
              <DropdownMenuItem disabled={!canEdit} onSelect={() => setRename(true)}>
                <Pencil />
                Rename tab
              </DropdownMenuItem>
            )}
            {fork && (
              <DropdownMenuItem
                onSelect={() => {
                  fork();
                  onComplete?.();
                }}
              >
                <GitFork />
                Fork chat
              </DropdownMenuItem>
            )}
            {(onPin || canRename || fork) && <DropdownMenuSeparator />}
            <DropdownMenuLabel>Tab type</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={pane.terminalProfile?.id ?? pane.profile}
              onValueChange={(id) => {
                const option = options.find((item) => item.id === id);
                if (option)
                  command({
                    kind: "pane.configure",
                    ...target,
                    profile: option.profile,
                    ...(profiles.supported && option.terminalProfileId
                      ? { terminalProfileId: option.terminalProfileId }
                      : {}),
                  });
              }}
            >
              {options.map(({ id, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={id} value={id} disabled={!canEdit}>
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canEdit} onSelect={() => setClosing(true)}>
              <X />
              Close tab…
            </DropdownMenuItem>
            {onDelete && (
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 />
                Delete…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {error && (
        <Dialog open onOpenChange={() => setError(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Workspace action failed</DialogTitle>
              <DialogDescription>{error}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )}
      <DeleteChatDialog
        key={deleting?.chat.id}
        chat={deleting?.chat ?? null}
        open={!!deleting?.open}
        canDelete={!!menu?.actions}
        onConfirm={(chat) => {
          if (menu) void menu.remove(chat);
          onComplete?.();
        }}
        onClose={(id) =>
          setDeleting((current) =>
            current?.chat.id === id ? { chat: current.chat, open: false } : current,
          )
        }
      />
      {rename && (
        <FormDialog
          title="Rename tab"
          description={<span className="sr-only">The name updates on every connected client.</span>}
          fields={[{ name: "name", label: "Tab name", value: tab.name }]}
          onClose={() => setRename(false)}
          onSubmit={(values) =>
            execute({
              kind: "tab.rename",
              projectId: project.id,
              expectedVersion: project.version,
              tabId: tab.id,
              name: values["name"] ?? "",
            }).then(() => onComplete?.())
          }
        />
      )}
      <Dialog
        open={closing}
        onOpenChange={(open) => {
          if (!open && !busy) setClosing(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close tab?</DialogTitle>
            <DialogDescription>This closes the tab on all your devices.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setClosing(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!canEdit || busy}
              onClick={() => {
                setBusy(true);
                void execute({ kind: "pane.close", ...target })
                  .then(() => {
                    setClosing(false);
                    if (selected) onSelect({ projectId: project.id, tabId: tab.id });
                    onComplete?.();
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : "Could not close"),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Close tab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
