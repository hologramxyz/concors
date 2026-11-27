import { useContext, useState } from "react";
import { useAgents } from "@/agents/context";
import { ProjectImage } from "@/workspace/project-image";
import { WorkspaceImageContext, projectImageProps } from "@/workspace/use-project-icons";
import { AtSign, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { mentionGroups, type SupervisorReference } from "./reference-text";
import { MentionIcon } from "./mention-menu";

/**
 * Mentions for the phone app's native message field, which cannot open a list as `@` is typed:
 * a button opens the same names in a drawer. Everywhere else `@` in the message does this. Closed
 * chats come last, folded under Closed as in the typed list.
 */
export function SupervisorReferencePicker({
  references,
  closed,
  disabled,
  onSelect,
}: {
  references: readonly SupervisorReference[];
  closed: ReadonlySet<string>;
  disabled: boolean;
  onSelect: (ref: SupervisorReference) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [closedOpen, setClosedOpen] = useState<boolean | null>(null);
  const agents = useAgents();
  const workspaceImage = useContext(WorkspaceImageContext);
  const groups = mentionGroups(references, closed, query, closedOpen, references.length);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    setQuery("");
    setClosedOpen(null);
  };
  const option = (ref: SupervisorReference) => {
    const place = workspaceImage(agents.find((agent) => agent.id === ref.id)?.projectId ?? "");
    return (
      <button
        key={ref.kind + ref.id}
        type="button"
        role="option"
        aria-selected={false}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm hover:bg-accent/60"
        onClick={() => {
          onSelect(ref);
          changeOpen(false);
        }}
      >
        <MentionIcon reference={ref} />
        <span className="min-w-0 truncate">{ref.label}</span>
        {/* As in the typed list: a workspace's icon says what it is, and a chat's workspace is
            the quietest meta type, led by its image, given only the room the name leaves. */}
        {ref.kind === "Agent" ? (
          <span className="flex min-w-0 flex-1 items-center justify-end gap-1 text-[11px] text-muted-foreground">
            <ProjectImage
              key={place?.source ?? "fallback"}
              {...projectImageProps(place, ref.workspace)}
              size={12}
            />
            <span className="min-w-0 truncate">{ref.workspace}</span>
          </span>
        ) : (
          <span className="sr-only">Workspace</span>
        )}
      </button>
    );
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="agent-control"
          aria-label="Mention an agent or workspace"
          disabled={disabled}
        >
          <AtSign className="size-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="gap-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Mention</DialogTitle>
          <DialogDescription className="sr-only">An agent or workspace</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search agents and workspaces"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
        />
        <div
          role="listbox"
          aria-label="Mention"
          className="chat-scroll -mx-2 max-h-80 overflow-y-auto"
        >
          {groups.open.map(option)}
          {groups.closedMatches > 0 && (
            // The sidebar's Closed fold, a full tap tall.
            <button
              type="button"
              aria-expanded={groups.closedOpen}
              onClick={() => setClosedOpen(!groups.closedOpen)}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-accent/60"
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                <ChevronRight
                  aria-hidden="true"
                  className={`size-3.5 transition-transform motion-reduce:transition-none ${groups.closedOpen ? "rotate-90" : ""}`}
                />
              </span>
              <span className="flex-1">Closed</span>
            </button>
          )}
          {groups.closed.map(option)}
          {!groups.open.length && !groups.closedMatches && (
            <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
