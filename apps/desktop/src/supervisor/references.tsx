import { useState } from "react";
import { AtSign, Bot, Folder } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { matchReferences, type SupervisorReference } from "./reference-text";

/**
 * Mentions for the phone app's native message field, which cannot open a list as `@` is typed:
 * a button opens the same names in a drawer. Everywhere else `@` in the message does this.
 */
export function SupervisorReferencePicker({
  references,
  disabled,
  onSelect,
}: {
  references: readonly SupervisorReference[];
  disabled: boolean;
  onSelect: (ref: SupervisorReference) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = matchReferences(references, query, references.length);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    setQuery("");
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
          {shown.map((ref) => {
            const Icon = ref.kind === "Agent" ? Bot : Folder;
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
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{ref.label}</span>
                <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                  {ref.kind === "Agent" ? ref.workspace : "Workspace"}
                </span>
              </button>
            );
          })}
          {!shown.length && <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
