import { useEffect } from "react";
import { Bot } from "lucide-react";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { Chat } from "./chat";
import { AgentStatus } from "./state";
import { useAgents } from "./context";
export function AgentSidebar({
  onSelect,
  workspace,
}: {
  onSelect: (id: string) => void;
  workspace: WorkspaceSnapshot | null;
}) {
  const agents = useAgents()
    .filter((a) => a.status !== "idle")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!agents.length)
    return <p className="px-2 py-2 text-[13px] text-muted-foreground">No active agents.</p>;
  return (
    <ul className="mt-1 space-y-0.5">
      {agents.map((agent) => (
        <li key={agent.id}>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent"
            onClick={() => onSelect(agent.id)}
          >
            <Bot className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{agent.name}</span>
              <span className="block truncate text-[13px] text-muted-foreground">
                {workspace?.projects.find((p) => p.id === agent.projectId)?.name ??
                  "Removed project"}
              </span>
              <AgentStatus agent={agent} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
export function AgentsView({
  selectedId,
  onSelect,
  workspace,
  canEdit,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  workspace: WorkspaceSnapshot | null;
  canEdit: boolean;
}) {
  const agents = useAgents().toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];
  useEffect(() => {
    if (selected && selected.id !== selectedId) onSelect(selected.id);
  }, [selected, selectedId, onSelect]);
  if (!selected)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Bot className="size-10 text-muted-foreground/50" />
        <h2 className="text-lg font-medium">All your agents</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Choose Unified chat in a project pane to start Codex. Conversations across projects will
          appear here.
        </p>
      </div>
    );
  return (
    <div className="flex h-full min-h-0 min-w-0">
      <aside
        aria-label="Agent sessions"
        className="chat-scroll w-56 shrink-0 overflow-y-auto border-r p-2"
      >
        {agents.map((agent) => (
          <button
            key={agent.id}
            aria-pressed={selected.id === agent.id}
            className={`mb-1 w-full rounded-md px-3 py-3 text-left hover:bg-muted ${selected.id === agent.id ? "bg-muted" : ""}`}
            onClick={() => onSelect(agent.id)}
          >
            <span className="block truncate text-sm">{agent.name}</span>
            <span className="mb-1 block truncate text-[11px] text-muted-foreground">
              {workspace?.projects.find((p) => p.id === agent.projectId)?.name ?? "Removed project"}
            </span>
            <AgentStatus agent={agent} />
          </button>
        ))}
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Chat key={selected.id} sessionId={selected.id} canEdit={canEdit} />
      </section>
    </div>
  );
}
