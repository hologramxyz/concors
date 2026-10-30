import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatActions, TabPlace } from "./chat-actions";
import type { ChatToDelete } from "./chat-limit";

/** How long a deleted chat can still be brought back before it is really deleted. */
export const UNDO_MS = 10_000;

interface Pending {
  readonly chat: ChatToDelete;
  /** Where its tab was, if it was open, and whether that tab was selected, so Undo can put it back. */
  readonly place: TabPlace | null;
  readonly selected: boolean;
  readonly timer: ReturnType<typeof setTimeout>;
}

type Notice =
  { kind: "deleted"; id: string } | { kind: "failed"; id: string; message: string; name: string };

/**
 * Deletes chats after a pause that can be undone. The chat's row goes and its tab closes at once;
 * the machine is asked to delete it only once the notice ends, or sooner when another chat is
 * deleted or the window goes away.
 */
export function useDeferredDelete({
  actions,
  isSelected,
  onReopenSelected,
}: {
  actions: ChatActions | null;
  /** Whether the chat's tab is the one shown. */
  isSelected: (id: string) => boolean;
  /** Opens the chat again and shows it. */
  onReopenSelected: (id: string) => void;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const latest = useRef({ actions, onReopenSelected });
  useEffect(() => {
    latest.current = { actions, onReopenSelected };
  });

  const show = useCallback((id: string, shown: boolean) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (shown) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Asks the machine to delete it now. A chat it cannot delete comes back with the reason. */
  const commit = useCallback(
    (id: string) => {
      const entry = pending.current.get(id);
      const remove = latest.current.actions?.remove;
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.current.delete(id);
      setNotice((current) => (current?.id === id ? null : current));
      if (!remove) {
        show(id, true);
        return;
      }
      remove(id).then(
        () => show(id, true),
        (cause: unknown) => {
          show(id, true);
          setNotice({
            kind: "failed",
            id,
            name: entry.chat.name,
            message: cause instanceof Error ? cause.message : "Couldn’t delete the chat.",
          });
        },
      );
    },
    [show],
  );

  const remove = useCallback(
    async (chat: ChatToDelete) => {
      const current = latest.current.actions;
      if (!current) return;
      // One notice at a time: the chat deleted before this one is deleted now.
      for (const id of [...pending.current.keys()]) commit(id);
      const selected = isSelected(chat.id);
      show(chat.id, false);
      let place: TabPlace | null;
      try {
        place = await current.closePanes(chat.id);
      } catch (cause) {
        show(chat.id, true);
        setNotice({
          kind: "failed",
          id: chat.id,
          name: chat.name,
          message: cause instanceof Error ? cause.message : "Couldn’t delete the chat.",
        });
        return;
      }
      const timer = setTimeout(() => commit(chat.id), UNDO_MS);
      pending.current.set(chat.id, { chat, place, selected, timer });
      setNotice({ kind: "deleted", id: chat.id });
    },
    [commit, isSelected, show],
  );

  const undo = useCallback(
    (id: string) => {
      const entry = pending.current.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.current.delete(id);
      setNotice((current) => (current?.id === id ? null : current));
      show(id, true);
      const { place } = entry;
      const actions = latest.current.actions;
      if (!place || !actions) return;
      if (entry.selected) latest.current.onReopenSelected(id);
      else void actions.reopen(id).catch(() => undefined);
      // The machine adds the tab at the end; it goes back where it was.
      void actions.placeTab(id, place).catch(() => undefined);
    },
    [show],
  );

  // A window closed or reloaded meanwhile still deletes what it said it deleted.
  useEffect(() => {
    const flush = () => {
      for (const id of [...pending.current.keys()]) commit(id);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [commit]);

  // A failure stays a little longer than the undo, then goes on its own.
  useEffect(() => {
    if (notice?.kind !== "failed") return;
    const timer = setTimeout(() => setNotice(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const toast = notice && (
    <div
      role="status"
      className="fixed top-14 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-md border bg-popover p-3 text-ui shadow-md duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2"
    >
      <span className="min-w-0 truncate">
        {notice.kind === "deleted"
          ? "Chat deleted"
          : `Couldn’t delete “${notice.name}”. ${notice.message}`}
      </span>
      {notice.kind === "deleted" && (
        <Button type="button" variant="ghost" onClick={() => undo(notice.id)}>
          Undo
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        className="text-muted-foreground"
        onClick={() => (notice.kind === "deleted" ? commit(notice.id) : setNotice(null))}
      >
        <X />
      </Button>
    </div>
  );

  return { hidden, remove, toast };
}
