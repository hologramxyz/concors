import type { AgentCommand } from "@concors/protocol";
import { Popover } from "radix-ui";
import { useEffect, useId, useRef, type RefObject } from "react";

/**
 * The provider's commands, listed above the composer while a bare `/name` is typed. Focus stays in
 * the message field: the composer owns the keys and this list only renders and takes clicks.
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
          className="z-50 w-[min(28rem,var(--radix-popover-trigger-width))] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label="Commands"
            className="chat-scroll max-h-72 overflow-auto"
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
                className={`flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${active === index ? "bg-accent" : "hover:bg-accent"}`}
              >
                <span className="shrink-0 font-mono">/{command.name}</span>
                {command.argumentHint && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {command.argumentHint}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
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
