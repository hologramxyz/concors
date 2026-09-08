import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { WorkspaceProject, WorkspaceTab, LayoutNode } from "@concors/protocol";
import { LoaderCircle } from "lucide-react";
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
    <div
      className="flex min-h-0 flex-1 items-center justify-center bg-[var(--terminal-background)]"
      aria-busy={!error}
    >
      {error ? (
        <div className="flex max-w-sm flex-col items-center gap-3 p-5 text-center">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button size="sm" disabled={!canEdit || busy} onClick={() => void start()}>
            {busy ? "Starting…" : "Retry terminal"}
          </Button>
        </div>
      ) : (
        <span role="status" className="text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          <span className="sr-only">
            {canEdit ? "Starting terminal…" : "Waiting for terminal…"}
          </span>
        </span>
      )}
    </div>
  );
}
