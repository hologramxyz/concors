import { ChevronRight } from "lucide-react";
import { Popover } from "radix-ui";
import { useContext, useEffect, useId, useRef, type RefObject } from "react";
import { useAgents } from "@/agents/context";
import { ProviderIcon } from "@/agents/provider-icon";
import { ProjectImage } from "@/workspace/project-image";
import { WorkspaceImageContext } from "@/workspace/use-project-icons";
import type { SupervisorReference } from "./reference-text";

/**
 * A mention's mark, as its tab or sidebar row shows it: a chat by its provider's mark (only chats
 * can be mentioned; terminals cannot), a workspace by the sidebar's image for it. Muted, at the
 * icon size both lists had.
 */
export function MentionIcon({ reference }: { reference: SupervisorReference }) {
  const agent = useAgents().find((a) => a.id === reference.id);
  const image = useContext(WorkspaceImageContext)(reference.id);
  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
      {reference.kind === "Agent" ? (
        <ProviderIcon provider={agent?.provider ?? ""} />
      ) : (
        <ProjectImage
          key={image?.source ?? "fallback"}
          source={image?.source ?? null}
          isGit={image?.isGit ?? false}
          name={image?.name ?? reference.label}
          size={16}
        />
      )}
    </span>
  );
}

/**
 * The agents and workspaces an `@` being typed can name, listed above the composer as the slash
 * menu lists commands, and drawn the same way. Focus stays in the message: the composer owns the
 * keys, and this list only renders and takes clicks. Closed chats come last, under a Closed fold
 * drawn as the sidebar's. The list stacks upward from the best match, so the fold sits at the top:
 * its header first, then its rows, then the open rows nearest the message. The keys pass over the
 * header, which only a click opens, and reach the closed rows once they show (opened, or matching
 * a typed name).
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
  // Last in the reversed list, so it is the top row, above the rows it labels.
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
          className={`size-3.5 transition-transform motion-reduce:transition-none ${closedOpen ? "rotate-90" : ""}`}
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
              return (
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
                  <MentionIcon reference={reference} />
                  <span className="min-w-0 truncate">{reference.label}</span>
                  <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                    {reference.kind === "Agent" ? reference.workspace : "Workspace"}
                  </span>
                </button>
              );
            })}
            {closedFrom !== null && closedHeader}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
