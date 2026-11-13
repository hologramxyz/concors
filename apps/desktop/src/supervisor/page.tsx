import { useContext, useEffect, useState } from "react";
import {
  SUPERVISOR_CAPABILITY,
  type SupervisorDelivery,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { CompactLayoutContext } from "@/components/compact-layout";
import { ChatPane } from "@/agents/chat";
import { AgentStartedContext, useAgents } from "@/agents/context";
import { Button } from "@/components/ui/button";
import { SessionLinkContext } from "./session-link";

/** The ordinary unified chat, including its provider picker and native mobile composer. */
export function SupervisorPage({
  workspace,
  connected,
  onOpenAgent,
}: {
  workspace: WorkspaceSnapshot | null;
  connected: boolean;
  onOpenAgent: (id: string) => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const compact = useContext(CompactLayoutContext);
  const agents = useAgents();
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [deliveries, setDeliveries] = useState<SupervisorDelivery[]>([]);
  const supported =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes(SUPERVISOR_CAPABILITY);
  useEffect(() => {
    if (!connection || !connected || !supported) return;
    let current = true;
    void connection
      .requestSupervisor({ kind: "open" }, crypto.randomUUID())
      .then((result) => {
        if (!current) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        setError(null);
        setDeliveries(result.outcome.deliveries);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : "Could not open Supervisor");
      });
    return () => {
      current = false;
    };
  }, [connection, connected, supported, retry]);
  useEffect(() => {
    if (!connection || !connected || !supported) return;
    let current = true,
      pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void connection
        .requestSupervisor({ kind: "status" }, crypto.randomUUID())
        .then((result) => {
          if (current && result.outcome.status === "ok") setDeliveries(result.outcome.deliveries);
        })
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
    };
    // Read-only status; provider lifecycle hooks, not this timer, drive execution and completion.
    const interval = setInterval(refresh, 3000);
    const off = connection.onAgent((event) => {
      if (event.type === "agent.state") refresh();
    });
    refresh();
    return () => {
      current = false;
      clearInterval(interval);
      off();
    };
  }, [connection, connected, supported]);
  const project = workspace?.supervisor,
    tab = project?.tabs[0];
  const pane = tab?.nodes.find((node) => node.kind === "pane");
  const current = deliveries.filter((d) => d.supervisorId === pane?.sessionId).slice(0, 8);
  return (
    <AgentStartedContext value={undefined}>
      <SessionLinkContext value={onOpenAgent}>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col" data-testid="supervisor-page">
          {!compact && (
            <header className="flex shrink-0 items-center gap-3 px-6 pt-2 pb-3">
              <h2 className="text-base font-medium">Supervisor</h2>
              <span className="text-xs text-muted-foreground">All workspaces on this machine</span>
            </header>
          )}
          {!!current.length && (
            <details className="shrink-0 border-b px-6 py-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                Delegated work ·{" "}
                {
                  current.filter((d) =>
                    ["pending", "queued", "working", "needs_input"].includes(d.status),
                  ).length
                }{" "}
                active
              </summary>
              <div className="flex max-h-32 flex-col overflow-y-auto py-1">
                {current.map((delivery) => {
                  const target = agents.find((a) => a.id === delivery.sessionId);
                  const name =
                    workspace?.projects.find((p) => p.id === delivery.projectId)?.name ??
                    "Workspace";
                  return (
                    <Button
                      key={delivery.id}
                      variant="ghost"
                      size="sm"
                      className="justify-start gap-2 text-xs"
                      onClick={() => onOpenAgent(delivery.sessionId)}
                    >
                      <span className="truncate">
                        {name} /{" "}
                        {target?.paneName ?? target?.tabName ?? target?.name ?? "Conversation"}
                      </span>
                      <span className="ml-auto">{delivery.status.replaceAll("_", " ")}</span>
                    </Button>
                  );
                })}
              </div>
            </details>
          )}
          {error ? (
            <div role="alert" className="p-6 text-sm text-destructive">
              {error}
              <Button variant="outline" className="ml-3" onClick={() => setRetry((n) => n + 1)}>
                Retry
              </Button>
            </div>
          ) : !supported && connected ? (
            <p className="p-6 text-sm text-muted-foreground">
              Update the daemon on this machine to use Supervisor.
            </p>
          ) : project && tab && pane?.kind === "pane" ? (
            <ChatPane
              key={project.id}
              project={project}
              tab={tab}
              node={pane}
              canEdit={connected}
              start={
                <p className="pt-4 text-center text-xs text-muted-foreground">
                  Find a conversation or coordinate work across your workspaces.
                </p>
              }
            />
          ) : (
            <p role="status" className="p-6 text-sm text-muted-foreground">
              {connected ? "Opening Supervisor…" : "Connect to this machine to use Supervisor."}
            </p>
          )}
        </div>
      </SessionLinkContext>
    </AgentStartedContext>
  );
}
