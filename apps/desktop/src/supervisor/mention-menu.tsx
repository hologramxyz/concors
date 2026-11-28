import { ChevronRight } from "lucide-react";
import { Popover } from "radix-ui";
import {
  useContext,
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { useAgents } from "@/agents/context";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ProviderIcon } from "@/agents/provider-icon";
import { ProjectImage } from "@/workspace/project-image";
import { WorkspaceImageContext, projectImageProps } from "@/workspace/use-project-icons";
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
          {...projectImageProps(image, reference.label)}
          size={16}
        />
      )}
    </span>
  );
}

/**
 * A mention in a sent message as a chip, in the inline-code look, led by the mark the @ list gives
 * it, on the text's baseline and never split across lines. A gone target keeps the list's fallback
 * mark. `children` is the name, trimmed to its capitals as the chip's only flex item, so the chip
 * sits on the text's baseline in every engine, centred in its 20px. The 16px mark is inset 2px on
 * its left, top and bottom, then 4px to the name: whole pixels, so the edges round alike at any
 * device scale.
 */
export function MentionChip({
  reference,
  className = "",
  children,
  ...props
}: { reference: SupervisorReference; children: ReactNode } & Omit<
  ComponentProps<"span">,
  "children"
>) {
  return (
    <span
      {...props}
      className={`relative inline-flex h-[20px] items-center rounded-sm bg-muted pr-[4px] pl-[22px] font-medium whitespace-nowrap ${className}`}
    >
      <span className="absolute top-[2px] left-[2px] select-none *:size-auto">
        <MentionIcon reference={reference} />
      </span>
      <span className="[text-box:trim-both_cap_alphabetic]">{children}</span>
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
  const agents = useAgents();
  const workspaceImage = useContext(WorkspaceImageContext);
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
              const place = workspaceImage(
                agents.find((agent) => agent.id === reference.id)?.projectId ?? "",
              );
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
                  <MentionIcon reference={reference} />
                  <span className="min-w-0 truncate">{reference.label}</span>
                  {/* The workspace's own icon says what it is; only a screen reader hears it.
                      A chat's workspace is the quietest meta type, led by the sidebar's image for
                      it, and given only the room the name leaves over; the name shortens first. */}
                  {reference.kind === "Agent" ? (
                    <span className="flex min-w-0 flex-1 items-center justify-end gap-1 text-[11px] text-muted-foreground">
                      <ProjectImage
                        key={place?.source ?? "fallback"}
                        {...projectImageProps(place, reference.workspace)}
                        size={12}
                      />
                      <span className="min-w-0 truncate">{reference.workspace}</span>
                    </span>
                  ) : (
                    <span className="sr-only">Workspace</span>
                  )}
                </button>
              );
              // The menus' separator sets the closed rows apart from the open ones beneath them.
              return index === closedFrom && index > 0
                ? [
                    <DropdownMenuSeparator key="separator" aria-hidden className="mx-0 shrink-0" />,
                    row,
                  ]
                : row;
            })}
            {closedFrom !== null && closedHeader}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
