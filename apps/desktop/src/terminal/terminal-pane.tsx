import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { WorkspaceProject, WorkspaceTab, LayoutNode, TerminalInfo } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { TerminalConnectionContext } from "./connection-context";
import { TerminalSurface } from "./terminal-surface";

export function TerminalPane({
  project,
  tab,
  node,
  canEdit,
}: {
  project: WorkspaceProject;
  tab: WorkspaceTab;
  node: Extract<LayoutNode, { kind: "pane" }>;
  canEdit: boolean;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TerminalInfo[] | null>(null);
  const attempted = useRef(false);
  const start = useCallback(async () => {
    if (!connection?.workspace || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await connection.requestTerminal(
        {
          kind: "start",
          epoch: connection.workspace.epoch,
          projectId: project.id,
          tabId: tab.id,
          paneId: node.id,
          expectedVersion:
            connection.workspace.projects.find((item) => item.id === project.id)?.version ??
            project.version,
          expectedSessionId: node.sessionId,
          cols: 80,
          rows: 24,
        },
        crypto.randomUUID(),
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start terminal");
    } finally {
      setBusy(false);
    }
  }, [connection, busy, project.id, project.version, tab.id, node.id, node.sessionId]);
  useEffect(() => {
    if (node.sessionId || !canEdit || connection?.state.status !== "ready" || attempted.current)
      return;
    attempted.current = true;
    void start();
  }, [node.sessionId, canEdit, connection?.state.status, start]);
  if (node.sessionId)
    return (
      <TerminalSurface
        key={node.sessionId}
        sessionId={node.sessionId}
        canEdit={canEdit}
        onRestart={() => {
          void start();
        }}
        restartBusy={busy}
        launchError={error}
      />
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-5 text-center">
      <p className="text-sm font-medium">
        {node.profile === "shell"
          ? "A terminal for this project"
          : `Run ${node.profile} on this machine`}
      </p>
      <code className="max-w-full truncate text-xs text-muted-foreground" title={project.directory}>
        {project.directory}
      </code>
      <Button
        size="sm"
        disabled={!canEdit || busy}
        onClick={() => {
          void start();
        }}
      >
        {busy ? "Starting…" : node.profile === "shell" ? "Start terminal" : `Start ${node.profile}`}
      </Button>
      <button
        type="button"
        disabled={!canEdit || busy}
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={() => {
          if (!connection) return;
          void connection
            .requestTerminal({ kind: "list" }, crypto.randomUUID())
            .then((result) => {
              if (result.outcome.status === "error") throw new Error(result.outcome.message);
              setSessions(
                result.outcome.sessions.filter((session) => session.projectId === project.id),
              );
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "Could not load sessions"),
            );
        }}
      >
        Attach an existing session
      </button>
      {sessions && (
        <div className="w-full max-w-sm space-y-1">
          {sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sessions for this project yet.</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                disabled={!canEdit || busy}
                className="block w-full rounded border px-3 py-2 text-left text-xs hover:bg-muted"
                onClick={() => {
                  if (!connection) return;
                  setBusy(true);
                  void connection
                    .requestTerminal(
                      {
                        kind: "bind",
                        projectId: project.id,
                        tabId: tab.id,
                        paneId: node.id,
                        expectedVersion: project.version,
                        sessionId: session.id,
                      },
                      crypto.randomUUID(),
                    )
                    .then((result) => {
                      if (result.outcome.status === "error")
                        throw new Error(result.outcome.message);
                    })
                    .catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : "Could not attach"),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                {session.profile} · {session.status} · {session.id.slice(0, 8)}
              </button>
            ))
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="max-w-sm text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
