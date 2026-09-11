import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { List } from "lucide-react";
import type { MessageEntry } from "./message-index";

export function MessageNavigation({
  entries,
  viewport,
  onJump,
  loading,
  error,
  onRetry,
  hasEarlier,
  hasNewer,
}: {
  entries: MessageEntry[];
  viewport: RefObject<HTMLDivElement | null>;
  onJump: (entry: MessageEntry) => Promise<void>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  hasEarlier: boolean;
  hasNewer: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [jumpError, setJumpError] = useState<string | null>(null);
  const rail = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidate = useRef<number | null>(null);
  const engaged = useRef(false);
  const attention = hovered ?? focused;
  const clearHover = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    engaged.current = false;
    candidate.current = null;
    setHovered(null);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Several prompts can fit in the final viewport. At the bottom, select the
      // final prompt rather than whichever one happens to sit near the top.
      // Allow for fractional scroll positions and rounded viewport dimensions.
      if (!hasNewer && el.scrollHeight - Math.max(0, el.scrollTop) - el.clientHeight <= 2) {
        setActive(entries.at(-1)?.id ?? null);
        return;
      }
      const inset = Math.max(36, Number.parseFloat(getComputedStyle(el).scrollPaddingTop) || 0);
      const top = el.getBoundingClientRect().top + inset;
      const messages = el.querySelectorAll<HTMLElement>("[data-user-message]");
      let current = messages[0]?.dataset.userMessage ?? null;
      for (const message of messages) {
        if (message.getBoundingClientRect().top > top) break;
        current = message.dataset.userMessage ?? current;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    observer.observe(el);
    schedule();
    return () => {
      el.removeEventListener("scroll", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [viewport, entries, hasNewer]);
  const jump = async (entry: MessageEntry) => {
    if (jumping) return;
    setJumping(true);
    setJumpError(null);
    try {
      await onJump(entry);
      setOpen(false);
      clearHover();
    } catch (cause) {
      setJumpError(cause instanceof Error ? cause.message : "Could not find this message.");
    } finally {
      setJumping(false);
    }
  };
  if (!entries.length && !loading && !error && !hasEarlier) return null;
  const problem = jumpError ?? error;
  return (
    <>
      <nav
        ref={rail}
        aria-label="Your messages"
        aria-busy={loading || jumping}
        className="message-rail"
        onPointerLeave={clearHover}
      >
        {entries.map((entry, index) => {
          const distance = attention === null ? Infinity : Math.abs(index - attention);
          const weight = distance < 3 ? (1 - distance / 3) ** 2 : 0;
          return (
            <div
              key={entry.id}
              className="message-rail-slot"
              onPointerEnter={(event) => {
                if (event.pointerType === "touch") return;
                candidate.current = index;
                if (engaged.current) setHovered(index);
                else if (!timer.current)
                  timer.current = setTimeout(() => {
                    timer.current = null;
                    engaged.current = true;
                    setHovered(candidate.current);
                  }, 150);
              }}
            >
              <button
                type="button"
                className="message-rail-target"
                aria-label={`Message ${index + 1} of ${entries.length}: ${entry.preview}`}
                aria-current={entry.id === active ? "location" : undefined}
                tabIndex={entry.id === (active ?? entries[0]?.id) ? 0 : -1}
                aria-disabled={jumping}
                onClick={() => void jump(entry)}
                onFocus={() => setFocused(index)}
                onBlur={() => setFocused(null)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowDown"
                      ? Math.min(entries.length - 1, index + 1)
                      : event.key === "ArrowUp"
                        ? Math.max(0, index - 1)
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? entries.length - 1
                            : null;
                  if (event.key === "Escape") {
                    clearHover();
                    setFocused(null);
                  }
                  if (next === null) return;
                  event.preventDefault();
                  rail.current
                    ?.querySelectorAll<HTMLButtonElement>(".message-rail-target")
                    [next]?.focus();
                }}
              >
                <span
                  className="message-rail-tick"
                  data-active={entry.id === active}
                  data-attention={index === attention}
                  style={{
                    width: (entry.id === active ? 16 : 10) + weight * 14,
                    height: 2 + weight * 2,
                  }}
                />
              </button>
              {index === attention && (
                <div className="message-rail-preview" aria-hidden="true">
                  <span className="line-clamp-2">{entry.preview}</span>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="Browse your messages"
            className="message-list-trigger"
            title="Your messages"
          >
            <List className="size-4" />
          </button>
        </DialogTrigger>
        <DialogContent closeLabel="Close messages" className="overflow-hidden">
          <DialogHeader>
            <DialogTitle>Your messages</DialogTitle>
            <DialogDescription>Jump to a message in this conversation.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {hasEarlier && (
              <p className="p-3 text-sm text-muted-foreground">
                Scroll up in the conversation to load earlier messages.
              </p>
            )}
            {error && (
              <button
                className="w-full rounded-md p-3 text-left text-sm hover:bg-muted"
                onClick={onRetry}
              >
                Retry loading messages
              </button>
            )}
            {entries.map((entry, index) => (
              <button
                key={entry.id}
                disabled={jumping}
                aria-current={entry.id === active ? "location" : undefined}
                className="flex w-full gap-3 rounded-md px-2 py-3 text-left text-[15px] hover:bg-muted disabled:opacity-50 aria-[current=location]:bg-muted/60"
                onClick={() => void jump(entry)}
              >
                <span className="w-6 shrink-0 text-muted-foreground">{index + 1}</span>
                <span className="line-clamp-3 min-w-0 break-words">{entry.preview}</span>
              </button>
            ))}
          </DialogBody>
          {(loading || jumping) && (
            <p role="status" className="pt-2 text-sm text-muted-foreground">
              {jumping ? "Finding message…" : "Loading messages…"}
            </p>
          )}
          {problem && (
            <p role="alert" className="pt-2 text-sm text-destructive">
              {problem}
            </p>
          )}
        </DialogContent>
      </Dialog>
      {problem && !open && (
        <button
          onClick={() => setOpen(true)}
          className="absolute top-12 right-2 z-10 rounded border bg-background px-2 py-1 text-xs"
        >
          Could not load messages · Retry
        </button>
      )}
    </>
  );
}
