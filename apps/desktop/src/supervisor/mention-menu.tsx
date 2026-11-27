import { Bot, ChevronRight, Folder } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useRef, type RefObject } from "react";
import type { SupervisorReference } from "./reference-text";

/**
 * The agents and workspaces an `@` being typed can name, listed above the composer as the slash
 * menu lists commands, and drawn the same way. Focus stays in the message: the composer owns the
 * keys, and this list only renders and takes clicks. Closed chats come last, under a Closed fold
 * drawn as the sidebar's; the keys pass over its header, which only a click opens, and reach the
 * closed rows once they show (opened, or matching a typed name).
 */
export function MentionMenu({
  anchor,
  matches,
  closedFrom,
  closedOpen,
  onToggleClosed,
  active,
  surface,
  onActive,
  onChoose,
  onDismiss,
}: {
  anchor: RefObject<HTMLElement | null>;
  matches: readonly SupervisorReference[];
  /** Where the closed chats start among `matches`, or null when none match. */
  closedFrom: number | null;
  closedOpen: boolean;
  onToggleClosed: () => void;
  active: number;
  surface: string | undefined;
  onActive: (index: number) => void;
  onChoose: (reference: SupervisorReference) => void;
  onDismiss: () => void;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  // The list stacks upward, so the fold's rows open above its header and its chevron points to them.
  const closedHeader = (
    <button
      type="button"
      key="closed"
      aria-expanded={closedOpen}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggleClosed}
      className="flex w-full shrink-0 items-center gap-3 px-4 py-2 text-left text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 transition-transform motion-reduce:transition-none ${closedOpen ? "-rotate-90" : ""}`}
        />
      </span>
      <span className="flex-1">Closed</span>
    </button>
  );
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <Popover.Root
      open={!!matches.length || closedFrom !== null}
      onOpenChange={(open) => !open && onDismiss()}
    >
      <Popover.Anchor virtualRef={anchor as RefObject<HTMLElement>} />
      <Popover.Portal>
        <Popover.Content
          data-composer-surface={surface}
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchor.current?.contains(event.target))
              event.preventDefault();
          }}
          className="z-50 w-(--radix-popover-trigger-width) max-w-[calc(100vw-24px)] text-popover-foreground"
        >
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label="Mention"
            className="chat-scroll flex max-h-80 flex-col-reverse overflow-auto rounded-2xl border bg-popover py-1 shadow-lg"
          >
            {matches.map((reference, index) => {
              const Icon = reference.kind === "Agent" ? Bot : Folder;
              const row = (
                <button
                  type="button"
                  role="option"
                  id={`${id}-${index}`}
                  data-index={index}
                  aria-selected={active === index}
                  key={reference.kind + reference.id}
                  onMouseMove={() => onActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onChoose(reference)}
                  className={`flex w-full shrink-0 items-center gap-3 px-4 py-2.5 text-left text-sm ${active === index ? "bg-accent" : "hover:bg-accent/60"}`}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{reference.label}</span>
                  <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                    {reference.kind === "Agent" ? reference.workspace : "Workspace"}
                  </span>
                </button>
              );
              return index === closedFrom ? [closedHeader, row] : row;
            })}
            {closedFrom !== null && closedFrom >= matches.length && closedHeader}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
