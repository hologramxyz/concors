import { useContext, useState } from "react";
import type { TerminalInfo } from "@concors/protocol";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TerminalConnectionContext } from "./connection-context";

/** Keeps detached sessions discoverable and stoppable, including after a project is removed. */
export function SessionList() {
  const connection = useContext(TerminalConnectionContext);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<TerminalInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    if (!connection) return;
    try {
      const result = await connection.requestTerminal({ kind: "list" }, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      setSessions(result.outcome.sessions);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load sessions");
    }
  };
  return (
    <>
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
      >
        Sessions
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terminal sessions</DialogTitle>
            <DialogDescription>
              Sessions keep running when panes close. To reopen one, create an empty terminal pane
              in its project and choose “Attach an existing session”.
            </DialogDescription>
          </DialogHeader>
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            className="text-left text-xs text-primary"
          >
            Refresh sessions
          </button>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No terminal sessions on this machine yet.
            </p>
          )}
          {sessions.map((session) => (
            <div key={session.id} className="rounded border p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {session.profile} · {session.status} · {session.id.slice(0, 8)}
                </span>
                {session.status === "running" && (
                  <button
                    type="button"
                    className="text-destructive"
                    onClick={() => {
                      if (!connection) return;
                      void connection
                        .requestTerminal(
                          { kind: "stop", sessionId: session.id },
                          crypto.randomUUID(),
                        )
                        .then((result) => {
                          if (result.outcome.status === "error")
                            throw new Error(result.outcome.message);
                          void refresh();
                        })
                        .catch((cause: unknown) =>
                          setError(
                            cause instanceof Error ? cause.message : "Could not stop session",
                          ),
                        );
                    }}
                  >
                    Stop
                  </button>
                )}
              </div>
              <p className="mt-1 truncate text-muted-foreground" title={session.directory}>
                {session.directory}
              </p>
              {session.error && <p className="mt-1 text-destructive">{session.error}</p>}
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
