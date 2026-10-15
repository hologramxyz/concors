import { useContext, useEffect, useState } from "react";
import { agentProviderName, type AgentInfo } from "@concors/protocol";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { mcpStatusLabel } from "./mcp-status";

const TONES = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
  muted: "text-muted-foreground",
} as const;

/** The MCP servers this agent loaded, as its CLI reports them right now. */
export function McpStatusDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: AgentInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [servers, setServers] = useState<{ name: string; status: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !connection) return;
    let cancelled = false;
    connection.requestAgent({ kind: "mcp-status", sessionId: agent.id }, crypto.randomUUID()).then(
      (result) => {
        if (cancelled) return;
        if (result.outcome.status === "error") setError(result.outcome.message);
        else setServers(result.outcome.servers ?? []);
      },
      (cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not read MCP servers.");
      },
    );
    return () => {
      cancelled = true;
      setServers(null);
      setError(null);
    };
  }, [open, connection, agent.id]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>MCP servers</DialogTitle>
          <DialogDescription>
            The MCP servers {agent.providerLabel ?? agentProviderName(agent.provider)} has loaded in
            this conversation. To add or change servers for every agent on this machine, go to
            Settings → MCP servers.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : !servers ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking servers…
          </p>
        ) : servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">This agent has no MCP servers.</p>
        ) : (
          <ul aria-label="MCP server status" className="divide-y rounded-md border text-sm">
            {servers.map((server) => {
              const status = mcpStatusLabel(server.status);
              return (
                <li key={server.name} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate font-mono text-xs">
                    {server.name === "concors-schedules"
                      ? "Concors schedules (built in)"
                      : server.name}
                  </span>
                  <span className={`shrink-0 text-xs ${TONES[status.tone]}`}>{status.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
