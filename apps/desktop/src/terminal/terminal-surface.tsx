import { useContext, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { TerminalInfo, TerminalOperation } from "@concors/protocol";
import { TerminalConnectionContext } from "./connection-context";
import "@xterm/xterm/css/xterm.css";

export function TerminalSurface({
  sessionId,
  canEdit,
  onRestart,
  restartBusy,
  launchError,
}: {
  sessionId: string;
  canEdit: boolean;
  onRestart: () => void;
  restartBusy: boolean;
  launchError: string | null;
}) {
  const connection = useContext(TerminalConnectionContext);
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef<{ claim: () => void; stop: () => void } | null>(null);
  const [session, setSession] = useState<TerminalInfo | null>(null);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!host.current || !connection) return;
    let disposed = false,
      owner = false,
      sequence = -1,
      viewerId = "",
      snapshotPending = false;
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: '"SF Mono", Consolas, monospace',
      scrollback: 1000,
      screenReaderMode: true,
      theme: { background: "#15151b", foreground: "#e4e4ea", cursor: "#c5c5ef" },
      disableStdin: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    const report = (cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : "Terminal request failed");
    };
    const request = async (operation: TerminalOperation) => {
      const result = await connection.requestTerminal(operation, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      return result.outcome.sessions;
    };
    const attach = () => {
      if (
        snapshotPending ||
        disposed ||
        connection.state.status !== "ready" ||
        !connection.workspace
      )
        return;
      snapshotPending = true;
      void request({ kind: "attach", sessionId })
        .catch(report)
        .finally(() => {
          snapshotPending = false;
        });
    };
    const dimensions = () => {
      const proposed = fit.proposeDimensions();
      return {
        cols: Math.max(10, Math.min(240, proposed?.cols ?? 80)),
        rows: Math.max(2, Math.min(100, proposed?.rows ?? 24)),
      };
    };
    const claim = () => {
      setError(null);
      void request({ kind: "claim", sessionId, ...dimensions() })
        .then(() => {
          if (!disposed) terminal.focus();
        })
        .catch(report);
    };
    controls.current = {
      claim,
      stop: () => {
        void request({ kind: "stop", sessionId }).catch(report);
      },
    };
    const unsubscribe = connection.onTerminal((event) => {
      if (disposed) return;
      if (event.type === "terminal.snapshot" && event.session.id === sessionId) {
        sequence = event.sequence;
        viewerId = event.viewerId;
        owner = event.ownerId === viewerId;
        terminal.reset();
        terminal.resize(event.session.cols, event.session.rows);
        terminal.write(event.data);
        terminal.options.disableStdin = !owner || event.session.status !== "running";
        setSession(event.session);
        setControlling(owner);
        setError(null);
      } else if (event.type === "terminal.output" && event.sessionId === sessionId) {
        if (event.sequence <= sequence) return;
        if (event.sequence !== sequence + 1) {
          attach();
          return;
        }
        sequence = event.sequence;
        terminal.write(event.data);
      } else if (event.type === "terminal.owner" && event.sessionId === sessionId) {
        owner = event.ownerId === viewerId;
        terminal.resize(event.cols, event.rows);
        terminal.options.disableStdin = !owner;
        setControlling(owner);
      } else if (event.type === "terminal.state" && event.session.id === sessionId) {
        setSession(event.session);
        if (event.session.status !== "running") terminal.options.disableStdin = true;
      } else if (event.type === "terminal.error" && event.sessionId === sessionId)
        setError(event.message);
    });
    const input = terminal.onData((data) => {
      if (!owner || disposed) return;
      try {
        // Bound each input frame. Never replay typed input automatically after reconnect.
        for (let offset = 0; offset < data.length; offset += 8192)
          connection.sendTerminalInput(sessionId, data.slice(offset, offset + 8192));
      } catch (cause) {
        report(cause);
      }
    });
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      if (owner)
        resizeTimer = setTimeout(() => {
          if (!disposed && owner)
            void request({ kind: "resize", sessionId, ...dimensions() }).catch(report);
        }, 100);
    });
    observer.observe(host.current);
    const unsubscribeWorkspace = connection.subscribeWorkspace(() => {
      if (sequence < 0) attach();
    });
    const unsubscribeState = connection.subscribe((state) => {
      if (state.status !== "ready") {
        terminal.options.disableStdin = true;
        sequence = -1;
        snapshotPending = false;
        owner = false;
        setControlling(false);
      }
    });
    attach();
    return () => {
      disposed = true;
      controls.current = null;
      clearTimeout(resizeTimer);
      observer.disconnect();
      input.dispose();
      unsubscribe();
      unsubscribeWorkspace();
      unsubscribeState();
      if (connection.state.status === "ready" && connection.workspace)
        void request({ kind: "detach", sessionId }).catch(() => undefined);
      terminal.dispose();
    };
  }, [connection, sessionId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-2 py-1 text-[11px] text-muted-foreground">
        <span>{!canEdit ? "Disconnected" : (session?.status ?? "Attaching…")}</span>
        {session?.status === "running" && (
          <>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => controls.current?.claim()}
              className="text-primary disabled:opacity-50"
            >
              {controlling ? "You have control" : "Take control"}
            </button>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => controls.current?.stop()}
              className="ml-auto hover:text-destructive"
            >
              Stop session
            </button>
          </>
        )}
        {session && !["running", "starting"].includes(session.status) && (
          <button
            type="button"
            disabled={!canEdit || restartBusy}
            onClick={onRestart}
            className="text-primary"
          >
            {restartBusy ? "Starting…" : "Start new session"}
          </button>
        )}
      </div>
      {(error || launchError || session?.error) && (
        <p role="alert" className="shrink-0 px-2 py-1 text-xs text-destructive">
          {error ?? launchError ?? session?.error}
        </p>
      )}
      <div
        ref={host}
        aria-label="Terminal output"
        className="min-h-0 flex-1 overflow-auto bg-[#15151b] p-2"
      />
    </div>
  );
}
