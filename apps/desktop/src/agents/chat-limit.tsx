import { useContext, useEffect, useState } from "react";
import { Pin, X } from "lucide-react";
import {
  AGENT_SESSION_LIMIT,
  AGENT_SESSION_WARNING,
  type AgentInfo,
  type RetiredAgent,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { shownSessions } from "@/terminal/background-terminals";
import { shortAge, useMinuteClock } from "@/workspace/sidebar-rows";
import { chatName, type ChatActions } from "./chat-actions";

const ACTIVE = ["starting", "working", "needs_input"];

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

/** A chat's workspace by name, open or closed. */
const workspaceName = (
  workspace: Pick<WorkspaceSnapshot, "projects" | "closedProjects"> | null,
  id: string,
) =>
  [...(workspace?.projects ?? []), ...(workspace?.closedProjects ?? [])].find(
    (project) => project.id === id,
  )?.name ?? "Unavailable workspace";

/** The chat a delete was asked for: its ID, and its name as the menu showed it. */
export interface ChatToDelete {
  readonly id: string;
  readonly name: string;
}

/**
 * Confirms deleting `chat`, which `onConfirm` then deletes (with a moment to undo). Mount it keyed
 * by the chat's ID, so it can only ever confirm the chat it was opened for.
 */
export function DeleteChatDialog({
  chat,
  open,
  canDelete,
  onConfirm,
  onClose,
}: {
  chat: ChatToDelete | null;
  open: boolean;
  canDelete: boolean;
  onConfirm: (chat: ChatToDelete) => void;
  /** Called with the ID it was confirming, so it can never close another chat's dialog. */
  onClose: (id: string) => void;
}) {
  const close = () => {
    if (chat) onClose(chat.id);
  };
  return (
    <Dialog open={open && !!chat} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{chat?.name}”?</DialogTitle>
          <DialogDescription>You’ll have a few seconds to undo.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canDelete}
            onClick={() => {
              if (!chat) return;
              close();
              onConfirm(chat);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SNOOZE_KEY = "concors.chatLimitKeptAt";
function snoozedAt(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * A quiet line at the bottom of the sidebar once the machine holds AGENT_SESSION_WARNING chats.
 * "Keep all" in the review hides it until another chat is saved.
 */
export function ChatLimitBanner({
  workspace,
  chats,
  actions,
}: {
  workspace: Pick<WorkspaceSnapshot, "projects"> | null;
  chats: readonly AgentInfo[];
  actions: ChatActions | null;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [reviews, setReviews] = useState(0);
  const [keptAt, setKeptAt] = useState(snoozedAt);
  const near = chats.length >= AGENT_SESSION_WARNING && chats.length > keptAt;
  if (!actions || (!near && !reviewing)) return null;
  return (
    <>
      {near && (
        <div
          role="status"
          className="mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground"
        >
          <span className="min-w-0 flex-1 truncate">Close to the chat limit</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setReviews((count) => count + 1);
              setReviewing(true);
            }}
          >
            Review
          </Button>
        </div>
      )}
      <ReviewChatsDialog
        key={reviews}
        open={reviewing}
        onOpenChange={setReviewing}
        workspace={workspace}
        chats={chats}
        actions={actions}
        onKeepAll={() => {
          try {
            localStorage.setItem(SNOOZE_KEY, String(chats.length));
          } catch {
            // Hidden for this window only.
          }
          setKeptAt(chats.length);
          setReviewing(false);
        }}
      />
    </>
  );
}

/**
 * Closed, unpinned chats, oldest first, with the oldest selected: as many as bring the machine
 * back under the warning. Pinning one here protects it and takes it off the list.
 */
function ReviewChatsDialog({
  open,
  onOpenChange,
  workspace,
  chats,
  actions,
  onKeepAll,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Pick<WorkspaceSnapshot, "projects"> | null;
  chats: readonly AgentInfo[];
  actions: ChatActions;
  onKeepAll: () => void;
}) {
  const shown = shownSessions(workspace);
  const closed = chats
    .filter((chat) => !shown.has(chat.id) && !chat.pinned && !ACTIVE.includes(chat.status))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  // Mounted afresh for each review (see its key), so the oldest are selected as it opens.
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        closed
          .slice(0, Math.max(1, chats.length - (AGENT_SESSION_WARNING - 1)))
          .map((chat) => chat.id),
      ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useMinuteClock();
  const projectName = (id: string) => workspaceName(workspace, id);
  const chosen = closed.filter((chat) => selected.has(chat.id));
  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    work()
      .catch((cause: unknown) => setError(errorText(cause, "Could not change the chats.")))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review chats</DialogTitle>
          <DialogDescription>
            This machine keeps up to {AGENT_SESSION_LIMIT} chats and has {chats.length}. Past the
            limit, the oldest closed chats are removed. Pinned chats are always kept.
          </DialogDescription>
        </DialogHeader>
        {closed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every chat is open, running or pinned. Close some to review them here.
          </p>
        ) : (
          <ul aria-label="Closed chats" className="-mx-2 max-h-80 space-y-0.5 overflow-y-auto">
            {closed.map((chat) => (
              <li
                key={chat.id}
                data-agent-id={chat.id}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-ui hover:bg-muted/50"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={selected.has(chat.id)}
                    disabled={busy}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.currentTarget.checked) next.add(chat.id);
                      else next.delete(chat.id);
                      setSelected(next);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{chatName(chat)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {projectName(chat.projectId)}
                    </span>
                  </span>
                </label>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {shortAge(chat.updatedAt, now)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Pin ${chatName(chat)}`}
                  title="Pin to keep"
                  className="text-muted-foreground"
                  disabled={busy}
                  onClick={() => run(() => actions.pin(chat, true))}
                >
                  <Pin />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onKeepAll}>
            Keep all
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || chosen.length === 0}
            onClick={() =>
              run(async () => {
                for (const chat of chosen) await actions.remove(chat.id);
                onOpenChange(false);
              })
            }
          >
            Delete selected{chosen.length ? ` (${chosen.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One line after the machine removed old chats to make room for a new one, with the list a click
 * away.
 */
export function RetiredChatsNotice({
  workspace,
}: {
  workspace: Pick<WorkspaceSnapshot, "projects"> | null;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [retired, setRetired] = useState<readonly RetiredAgent[]>([]);
  const [listing, setListing] = useState(false);
  useEffect(
    () =>
      connection?.onAgent((event) => {
        if (event.type === "agent.list" && event.retired?.length) {
          setRetired(event.retired);
          setListing(false);
        }
      }),
    [connection],
  );
  useEffect(() => {
    if (!retired.length || listing) return;
    const timer = setTimeout(() => setRetired([]), 10_000);
    return () => clearTimeout(timer);
  }, [retired, listing]);
  if (!retired.length) return null;
  const projectName = (id: string) => workspaceName(workspace, id);
  const dismiss = () => {
    setRetired([]);
    setListing(false);
  };
  return (
    <>
      {!listing && (
        <div
          role="status"
          className="fixed top-14 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-md border bg-popover p-3 text-ui shadow-md duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2"
        >
          <span className="min-w-0 truncate">
            Removed {retired.length} old {retired.length === 1 ? "chat" : "chats"}
          </span>
          <Button type="button" variant="ghost" onClick={() => setListing(true)}>
            See which
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            className="text-muted-foreground"
            onClick={dismiss}
          >
            <X />
          </Button>
        </div>
      )}
      <Dialog open={listing} onOpenChange={(open) => !open && dismiss()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Removed chats</DialogTitle>
            <DialogDescription>
              The oldest closed chats made room for a new one. Pin a chat to keep it.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {retired.map((chat) => (
              <li key={chat.id} className="text-ui">
                <span className="block truncate">{chat.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {projectName(chat.projectId)}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
