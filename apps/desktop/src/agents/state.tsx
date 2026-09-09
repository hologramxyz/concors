import { AgentsContext, AGENT_STATUS } from "./context";
import { useEffect, useState } from "react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentInfo } from "@concors/protocol";
export function AgentsProvider({
  connection,
  children,
}: {
  connection: DaemonConnection | null;
  children: React.ReactNode;
}) {
  const [replica, setReplica] = useState<{
    connection: DaemonConnection;
    agents: AgentInfo[];
  } | null>(null);
  useEffect(
    () =>
      connection?.onAgent((event) => {
        if (event.type !== "agent.item") setReplica({ connection, agents: connection.agents });
      }),
    [connection],
  );
  return (
    <AgentsContext value={replica?.connection === connection ? (replica?.agents ?? []) : []}>
      {children}
    </AgentsContext>
  );
}
export function AgentStatus({ agent }: { agent: AgentInfo }) {
  const active = ["starting", "working", "needs_input"].includes(agent.status);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const seconds = agent.turnStartedAt
    ? Math.max(
        0,
        Math.floor(
          ((active ? now : Date.parse(agent.updatedAt)) - Date.parse(agent.turnStartedAt)) / 1000,
        ),
      )
    : null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
      aria-label={`Agent status: ${AGENT_STATUS[agent.status]}`}
    >
      <span
        className={`size-1.5 rounded-full ${agent.status === "needs_input" ? "bg-amber-500" : agent.status === "failed" ? "bg-destructive" : agent.status === "working" || agent.status === "starting" ? "animate-pulse bg-primary" : agent.status === "done" ? "bg-emerald-500" : "bg-muted-foreground"}`}
      />
      {AGENT_STATUS[agent.status]}
      {agent.attention && !agent.attention.seen && (
        <span aria-label="Unread agent update" className="rounded bg-primary/15 px-1 text-primary">
          New
        </span>
      )}
      {seconds !== null && (
        <span className="tabular-nums">
          · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      )}
    </span>
  );
}
