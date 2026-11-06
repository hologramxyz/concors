import { useState } from "react";
import { useCommand } from "@/shortcuts/context";
import { Ellipsis, GitFork, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import type { WorkspaceOperation, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import type { MobileTarget } from "@concors/client-core";
import {
  RowMenuGroup,
  RowMenuItem,
  RowMenuRadioItem,
  RowMenuSeparator,
  RowMenuSheet,
} from "@/components/row-menu-sheet";
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

/** A menu item that opens a dialog of its own. */
export type TabStep = "rename" | "close" | "delete";

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
  title,
  keyboard = false,
  showTrigger = true,
  sidebar = false,
  step,
  onStep,
  onComplete,
  opened,
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
  /** The menu sheet's title: the tab's name. */
  title: string;
  keyboard?: boolean;
  showTrigger?: boolean;
  /** Drawn as the sidebar's row menus are, rather than the Tabs sheet's. */
  sidebar?: boolean;
  /** Opens this step's dialog at once, for a menu whose sheet has already gone. */
  step?: TabStep;
  /**
   * Hands a chosen step to the owner instead of opening its dialog here, so the owner can close
   * its own sheet first and the dialog shows alone.
   */
  onStep?(step: TabStep): void;
  onComplete?(): void;
  /** Shows the menu sheet at once, without its "…" button: the tab strip opens it on a long-press. */
  opened?: { returnFocus(): HTMLElement | null } | undefined;
}) {
  const profiles = useTerminalProfiles();
  const options = paneProfiles(profiles.profiles);
  const [rename, setRename] = useState(step === "rename");
  const [closing, setClosing] = useState(step === "close");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Desktop's chat row actions, offered when its sidebar would offer them for this tab's chat.
  const menu = useChatMenu();
  const chat = useAgents().find((agent) => agent.id === pane.sessionId);
  // The chat stays set while its dialog closes, so it can ease out under the same name.
  const [deleting, setDeleting] = useState<{ chat: ChatToDelete; open: boolean } | null>(() =>
    step === "delete" && chat ? { chat: { id: chat.id, name: chatName(chat) }, open: true } : null,
  );
  const onPin = menu?.pin(chat);
  const fork = menu?.fork(chat);
  // Only desktop tabs have saved names. Do not rename split siblings together.
  const canRename = tabPanes(tab).length === 1;
  const onDelete =
    menu?.canDelete && chat
      ? () => setDeleting({ chat: { id: chat.id, name: chatName(chat) }, open: true })
      : undefined;
  const begin = (next: TabStep) => {
    if (onStep) onStep(next);
    else if (next === "rename") setRename(true);
    else if (next === "close") setClosing(true);
    else onDelete?.();
  };

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
      {(showTrigger || opened) && (
        <RowMenuSheet
          label={label}
          title={title}
          opened={opened}
          className={
            sidebar
              ? "mobile-tap-target mr-1 flex items-center justify-center rounded p-1 text-muted-foreground hover:text-sidebar-foreground"
              : "mobile-icon mobile-row-actions"
          }
          icon={<Ellipsis className={sidebar ? "size-4" : undefined} />}
        >
          {onPin && (
            <RowMenuItem icon={chat?.pinned ? <PinOff /> : <Pin />} onSelect={onPin}>
              {chat?.pinned ? "Unpin" : "Pin"}
            </RowMenuItem>
          )}
          {canRename && (
            <RowMenuItem
              icon={<Pencil />}
              disabled={!canEdit}
              immediate={!!onStep}
              onSelect={() => begin("rename")}
            >
              Rename tab
            </RowMenuItem>
          )}
          {fork && (
            <RowMenuItem
              icon={<GitFork />}
              onSelect={() => {
                fork();
                onComplete?.();
              }}
            >
              Fork chat
            </RowMenuItem>
          )}
          {(onPin || canRename || fork) && <RowMenuSeparator />}
          <RowMenuGroup label="Tab type">
            {options.map(({ id, label, profile, terminalProfileId, icon: Icon }) => (
              <RowMenuRadioItem
                key={id}
                icon={<Icon aria-hidden="true" />}
                checked={(pane.terminalProfile?.id ?? pane.profile) === id}
                disabled={!canEdit}
                onSelect={() =>
                  command({
                    kind: "pane.configure",
                    ...target,
                    profile,
                    ...(profiles.supported && terminalProfileId ? { terminalProfileId } : {}),
                  })
                }
              >
                {label}
              </RowMenuRadioItem>
            ))}
          </RowMenuGroup>
          <RowMenuSeparator />
          <RowMenuItem
            icon={<X />}
            disabled={!canEdit}
            immediate={!!onStep}
            onSelect={() => begin("close")}
          >
            Close tab…
          </RowMenuItem>
          {onDelete && (
            <RowMenuItem
              icon={<Trash2 />}
              destructive
              immediate={!!onStep}
              onSelect={() => begin("delete")}
            >
              Delete…
            </RowMenuItem>
          )}
        </RowMenuSheet>
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
