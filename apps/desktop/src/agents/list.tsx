import { useEffect } from "react";
import { Bot, LoaderCircle } from "lucide-react";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { Chat } from "./chat";
import { AgentStatus } from "./state";
import { useAgents, AGENT_STATUS } from "./context";
export function AgentSidebar({ onSelect }: { onSelect: (id: string) => void }) {
  const agents = useAgents().toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!agents.length)
    return <p className="px-2 py-2 text-[13px] text-muted-foreground">No agents yet.</p>;
  return (
    <ul className="mt-1 space-y-0.5">
      {agents.map((agent) => {
        const running = agent.status === "starting" || agent.status === "working";
        const status = AGENT_STATUS[agent.status];
        const unread = agent.attention && !agent.attention.seen;
        return (
          <li key={agent.id}>
            <button
              type="button"
              title={`${agent.name} · ${status}${unread ? " · Unread update" : ""}`}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-sidebar-accent"
              onClick={() => onSelect(agent.id)}
            >
              <span
                role="img"
                aria-label={`Agent status: ${status}`}
                className="relative flex size-4 shrink-0 items-center justify-center"
              >
                {unread && (
                  <span
                    aria-label="Unread agent update"
                    className="absolute inset-0 rounded-full ring-1 ring-muted-foreground/40"
                  />
                )}
                {running ? (
                  <LoaderCircle
                    className="size-4 animate-spin text-amber-500 motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    className={`size-2.5 rounded-full border border-black/15 ${agent.status === "done" ? "bg-emerald-500" : agent.status === "failed" ? "bg-red-500" : agent.status === "needs_input" ? "bg-amber-500" : "bg-white"}`}
                  />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
            </button>
          </li>
        );
      })}
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
          Choose Agent in a project pane to start Codex. Conversations across projects will appear
          here.
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
