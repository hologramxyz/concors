import type { AgentCommand } from "@concors/protocol";
import { Popover } from "radix-ui";
import { useEffect, useId, useRef, type RefObject } from "react";

/**
 * The provider's commands, listed above the composer while a bare `/name` is typed. Focus stays in
 * the message field: the composer owns the keys and this list only renders and takes clicks.
 *
 * The list is as wide as the composer and stacks upward, so the best match sits next to the text
 * being typed. Rows truncate long descriptions; the card above shows the highlighted one in full.
 */
export function SlashCommandMenu({
  anchor,
  commands,
  active,
  surface,
  onActive,
  onChoose,
  onDismiss,
}: {
  anchor: RefObject<HTMLElement | null>;
  commands: readonly AgentCommand[];
  active: number;
  surface: string | undefined;
  onActive: (index: number) => void;
  onChoose: (command: AgentCommand) => void;
  onDismiss: () => void;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const highlighted = commands[active];
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <Popover.Root open={!!commands.length} onOpenChange={(open) => !open && onDismiss()}>
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
            // Clicking back into the message keeps the list; the draft decides whether it shows.
            if (event.target instanceof Node && anchor.current?.contains(event.target))
              event.preventDefault();
          }}
          className="z-50 flex w-(--radix-popover-trigger-width) max-w-[calc(100vw-24px)] flex-col gap-2 text-popover-foreground"
        >
          {highlighted && (
            <div
              aria-live="polite"
              data-slash-details
              className="rounded-2xl border bg-popover px-4 py-3 text-sm shadow-lg"
            >
              <p className="font-medium">/{highlighted.name}</p>
              {highlighted.description && (
                <p className="mt-1 text-muted-foreground">{highlighted.description}</p>
              )}
              {highlighted.argumentHint && (
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {highlighted.argumentHint}
                </p>
              )}
            </div>
          )}
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label="Commands"
            className="chat-scroll flex max-h-80 flex-col-reverse overflow-auto rounded-2xl border bg-popover py-1 shadow-lg"
          >
            {commands.map((command, index) => (
              <button
                type="button"
                role="option"
                id={`${id}-${index}`}
                data-index={index}
                aria-selected={active === index}
                key={command.name}
                onMouseMove={() => onActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChoose(command)}
                className={`flex w-full shrink-0 items-baseline gap-3 px-4 py-2.5 text-left text-sm ${active === index ? "bg-accent" : "hover:bg-accent/60"}`}
              >
                <span className="shrink-0">/{command.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {command.description}
                </span>
                {command.kind === "skill" && (
                  <span className="shrink-0 text-xs text-muted-foreground">Skill</span>
                )}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
