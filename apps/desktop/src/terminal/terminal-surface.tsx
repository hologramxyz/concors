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
  const [session, setSession] = useState<TerminalInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!host.current || !connection) return;
    let disposed = false,
      owner = false,
      sequence = -1,
      viewerId = "",
      snapshotPending = false,
      running = false;
    let claiming: Promise<void> | null = null;
    let activateAfterClaim = false;
    let queuedInput = "";
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: '"SF Mono", Consolas, monospace',
      scrollback: 1000,
      screenReaderMode: true,
      theme: {
        background: "#15151b",
        foreground: "#e4e4ea",
        cursor: "#c5c5ef",
        scrollbarSliderBackground: "#55556280",
        scrollbarSliderHoverBackground: "#777786b0",
        scrollbarSliderActiveBackground: "#9999a6",
      },
      disableStdin: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    const element = host.current;
    terminal.open(element);
    fit.fit();
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
    const sendInput = (data: string) => {
      for (let offset = 0; offset < data.length; offset += 8192)
        connection.sendTerminalInput(sessionId, data.slice(offset, offset + 8192));
    };
    const claim = (ifUnowned = false) => {
      if (disposed || !running || connection.state.status !== "ready") return;
      if (claiming) {
        if (!ifUnowned) activateAfterClaim = true;
        return;
      }
      setError(null);
      claiming = request({ kind: "claim", sessionId, ifUnowned, ...dimensions() })
        .then(() => {
          if (disposed || !owner) return;
          if (queuedInput) sendInput(queuedInput);
          // A split can remount this terminal while keyboard focus has moved to its sibling.
          // Acquiring control must not steal that newer focus (or focus from an open dialog).
          const focused = document.activeElement;
          const focusedPane = focused?.closest("[data-pane-id]");
          if (
            document.visibilityState === "visible" &&
            !focused?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') &&
            (!focusedPane || focusedPane === element.closest("[data-pane-id]"))
          )
            terminal.focus();
        })
        .catch(report)
        .finally(() => {
          claiming = null;
          if (activateAfterClaim && !owner && !disposed) {
            activateAfterClaim = false;
            claim();
          } else {
            activateAfterClaim = false;
            queuedInput = "";
          }
        });
    };
    // Focusing/clicking a terminal is the user's intent to type; no separate control button.
    const activate = () => {
      if (!owner) claim();
    };
    element.addEventListener("pointerdown", activate);
    element.addEventListener("focusin", activate);
    element.addEventListener("keydown", activate, true);
    const unsubscribe = connection.onTerminal((event) => {
      if (disposed) return;
      if (event.type === "terminal.snapshot" && event.session.id === sessionId) {
        sequence = event.sequence;
        running = event.session.status === "running";
        viewerId = event.viewerId;
        owner = event.ownerId === viewerId;
        terminal.reset();
        terminal.resize(event.session.cols, event.session.rows);
        terminal.write(event.data);
        terminal.options.disableStdin = !running;
        setSession(event.session);
        setError(null);
        if (running && event.ownerId === null) claim(true);
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
        terminal.options.disableStdin = !running;
      } else if (event.type === "terminal.state" && event.session.id === sessionId) {
        setSession(event.session);
        running = event.session.status === "running";
        if (!running) terminal.options.disableStdin = true;
      } else if (event.type === "terminal.error" && event.sessionId === sessionId)
        setError(event.message);
    });
    const input = terminal.onData((data) => {
      if (disposed || !running) return;
      try {
        // Ownership can arrive before the claim reply. Keep later keys behind buffered keys.
        if (claiming && queuedInput.length + data.length <= 16384) queuedInput += data;
        else if (owner && !claiming) sendInput(data);
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
        queuedInput = "";
        running = false;
        sequence = -1;
        snapshotPending = false;
        owner = false;
      }
    });
    attach();
    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      observer.disconnect();
      element.removeEventListener("pointerdown", activate);
      element.removeEventListener("focusin", activate);
      element.removeEventListener("keydown", activate, true);
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {session && !["running", "starting"].includes(session.status) && (
        <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
          <span>
            {session.status === "exited"
              ? "Session ended"
              : session.status === "interrupted"
                ? "Session interrupted"
                : "Session failed"}
          </span>
          <button
            type="button"
            disabled={!canEdit || restartBusy}
            onClick={onRestart}
            className="text-primary"
          >
            {restartBusy ? "Starting…" : "Start new session"}
          </button>
        </div>
      )}
      {(error || launchError || session?.error) && (
        <p role="alert" className="shrink-0 px-2 py-1 text-xs text-destructive">
          {error ?? launchError ?? session?.error}
        </p>
      )}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#15151b] p-2">
        <div
          ref={host}
          aria-label="Terminal output"
          className="concors-terminal h-full w-full overflow-hidden"
        />
      </div>
    </div>
  );
}
