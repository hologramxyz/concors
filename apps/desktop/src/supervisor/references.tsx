import { Popover } from "radix-ui";
import { CompactLayoutContext } from "@/components/compact-layout";
import { useContext, useState } from "react";
import { AtSign, Folder, Bot } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import type { SupervisorReference } from "./reference-context";

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
  const shown = references.filter((ref) =>
    `${ref.label} ${ref.workspace ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const compact = useContext(CompactLayoutContext);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    setQuery("");
  };
  const trigger = (
    <button
      type="button"
      className="agent-control"
      aria-label="Mention a workspace or agent"
      title="Mention a workspace or agent"
      disabled={disabled}
    >
      <AtSign className="size-4" />
    </button>
  );
  const picker = (
    <div className="min-w-0 space-y-2">
      {" "}
      <Input
        aria-label="Search workspaces and agents"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search workspaces and agents…"
      />
      <div className="chat-scroll max-h-72 space-y-2 overflow-y-auto">
        {(["Workspace", "Agent"] as const).map((kind) => {
          const items = shown.filter((ref) => ref.kind === kind);
          const Icon = kind === "Workspace" ? Folder : Bot;
          return (
            items.length > 0 && (
              <section key={kind} aria-label={kind === "Workspace" ? "Workspaces" : "Agents"}>
                <h3 className="px-2 py-1 text-xs text-muted-foreground">
                  {kind === "Workspace" ? "Workspaces" : "Agents"}
                </h3>
                {items.map((ref) => (
                  <button
                    key={ref.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-ui hover:bg-muted focus-visible:bg-muted"
                    onClick={() => {
                      onSelect(ref);
                      changeOpen(false);
                    }}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{ref.label}</span>
                    {ref.workspace && (
                      <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                        {ref.workspace}
                      </span>
                    )}
                  </button>
                ))}
              </section>
            )
          );
        })}
        {shown.length === 0 && (
          <p className="px-2 py-3 text-ui text-muted-foreground">No matches.</p>
        )}
      </div>
    </div>
  );
  return compact ? (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="gap-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Mention</DialogTitle>
          <DialogDescription>Add a workspace or agent to your message</DialogDescription>
        </DialogHeader>
        {picker}
      </DialogContent>
    </Dialog>
  ) : (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label="Mention"
          side="top"
          align="start"
          sideOffset={8}
          className="z-50 w-[300px] rounded-lg border bg-popover p-2 text-popover-foreground shadow-md outline-none"
        >
          {picker}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
