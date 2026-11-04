import { useContext, useEffect, useId, useRef, useState, type RefObject } from "react";
import { List } from "lucide-react";
import { Popover } from "radix-ui";
import { CompactLayoutContext } from "@/components/compact-layout";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ControlTooltip } from "./control-tooltip";
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
  const titleId = useId();
  const compact = useContext(CompactLayoutContext);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [active, setActive] = useState<string | null>(null);
  // A rail needs somewhere to jump: a single message, or messages that all fit on screen, show none.
  const [scrolls, setScrolls] = useState(false);
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
      setScrolls(hasEarlier || hasNewer || el.scrollHeight - el.clientHeight > 2);
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
  }, [viewport, entries, hasEarlier, hasNewer]);
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
  const list = (
    <>
      {hasEarlier && (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          Scroll up in the conversation to load earlier messages.
        </p>
      )}
      {error && (
        <button
          className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-accent"
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
          className="flex w-full gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50 aria-[current=location]:bg-accent/60"
          onClick={() => void jump(entry)}
        >
          <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{index + 1}</span>
          <span className="line-clamp-2 min-w-0 break-words">{entry.preview}</span>
        </button>
      ))}
    </>
  );
  const notes = (
    <>
      {(loading || jumping) && (
        <p role="status" className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
          {jumping ? "Finding message…" : "Loading messages…"}
        </p>
      )}
      {problem && (
        <p role="alert" className="px-2 pt-2 pb-1 text-xs text-destructive">
          {problem}
        </p>
      )}
    </>
  );
  return (
    <>
      <nav
        ref={rail}
        hidden={!scrolls || entries.length < 2}
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
                    width: (entry.id === active ? 10 : 6) + weight * 14,
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
      {compact ? (
        // On a phone it is the drawer every other sheet is: a popover there is small to reach and
        // has no way to close it but a tap elsewhere.
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="Browse your messages"
              className="message-list-trigger"
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
              {list}
              {notes}
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <ControlTooltip text="Your messages" hidden={open} side="bottom">
            <Popover.Trigger
              type="button"
              aria-label="Browse your messages"
              className="message-list-trigger"
            >
              <List className="size-4" />
            </Popover.Trigger>
          </ControlTooltip>
          {/*
            Holds the button's place: wide panes hide the button but can still open this on a retry.
            It goes after the trigger, which registers itself as the anchor until it knows of this one.
          */}
          <Popover.Anchor className="message-list-anchor" />
          <Popover.Portal>
            <Popover.Content
              aria-labelledby={titleId}
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={12}
              className="z-50 w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-[calc(var(--radius-lg)+(0.375rem+1px)*var(--concentric))] border bg-popover p-1.5 text-popover-foreground shadow-lg"
            >
              <p id={titleId} className="px-2 pt-1 pb-1.5 text-sm font-medium">
                Your messages
              </p>
              <div className="chat-scroll max-h-72 overflow-auto">{list}</div>
              {notes}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {problem && !open && (
        <button
          onClick={() => setOpen(true)}
          className="absolute top-12 right-2 z-10 rounded border bg-background px-2 py-1 text-xs"
        >
          Could not load messages. Retry
        </button>
      )}
    </>
  );
}
