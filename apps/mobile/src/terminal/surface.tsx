import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { newRequestId } from "@concors/client-core";
import type { TerminalOperation } from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";
import { useMachine } from "../connection/provider";
import { Button, Copy, Notice, layout } from "../ui";
import { TerminalRenderer } from "./renderer";
import type { RendererEvent, RendererHandle } from "./bridge";

export function TerminalSurface({ sessionId }: { sessionId: string }) {
  const { connection } = useMachine();
  const renderer = useRef<RendererHandle>(null);
  const input = useRef<(data: string) => void>(() => undefined);
  const resize = useRef<() => void>(() => undefined);
  const size = useRef({ cols: 80, rows: 24 });
  const [ready, setReady] = useState(false);
  const [rendererVersion, setRendererVersion] = useState(0);
  const [ownership, setOwnership] = useState<{
    transport: DaemonConnection;
    owned: boolean;
  } | null>(null);
  const owner =
    ready &&
    connection.phase === "ready" &&
    ownership?.transport === connection.transport &&
    ownership.owned;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const terminal = connection.terminals.find((item) => item.id === sessionId);
  const request = async (operation: TerminalOperation) => {
    if (!connection.transport) throw new Error("Reconnect to interact with the terminal.");
    const result = await connection.transport.requestTerminal(operation, newRequestId());
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
  };
  const event = useCallback((event: RendererEvent) => {
    if (event.type === "ready") setReady(true);
    if (event.type === "input") input.current(event.data);
    if (event.type === "resize") {
      size.current = { cols: event.cols, rows: event.rows };
      resize.current();
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!ready) setError("Terminal renderer did not start. Reload the terminal.");
    }, 10_000);
    return () => clearTimeout(timer);
  }, [ready, rendererVersion]);
  useEffect(() => {
    const transport = connection.transport;
    const surface = renderer.current;
    if (!ready || !transport) {
      surface?.send({ type: "enabled", value: false });
      return;
    }
    let disposed = false,
      owned = false,
      attaching = false;
    let running = false;
    let sequence = -1,
      viewerId = "";
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const report = (cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : "Terminal request failed.");
    };
    const attach = () => {
      if (attaching || disposed) return;
      attaching = true;
      void transport
        .requestTerminal({ kind: "attach", sessionId }, newRequestId())
        .then((result) => {
          if (result.outcome.status === "error") throw new Error(result.outcome.message);
        })
        .catch(report)
        .finally(() => {
          attaching = false;
        });
    };
    const off = transport.onTerminal((event) => {
      if (disposed) return;
      if (event.type === "terminal.snapshot" && event.session.id === sessionId) {
        sequence = event.sequence;
        viewerId = event.viewerId;
        running = event.session.status === "running";
        owned = running && event.ownerId === viewerId;
        setOwnership({ transport, owned });
        setError(null);
        renderer.current?.send({
          type: "reset",
          data: event.data,
          cols: event.session.cols,
          rows: event.session.rows,
        });
        renderer.current?.send({
          type: "enabled",
          value: owned && event.session.status === "running",
        });
      } else if (event.type === "terminal.output" && event.sessionId === sessionId) {
        if (event.sequence <= sequence) return;
        if (event.sequence !== sequence + 1) {
          attach();
          return;
        }
        sequence = event.sequence;
        renderer.current?.send({ type: "write", data: event.data });
      } else if (event.type === "terminal.owner" && event.sessionId === sessionId) {
        owned = running && event.ownerId === viewerId;
        setOwnership({ transport, owned });
        renderer.current?.send({ type: "resize", cols: event.cols, rows: event.rows });
        renderer.current?.send({ type: "enabled", value: owned });
      } else if (
        event.type === "terminal.state" &&
        event.session.id === sessionId &&
        event.session.status !== "running"
      ) {
        running = false;
        owned = false;
        setOwnership({ transport, owned });
        renderer.current?.send({ type: "enabled", value: false });
      }
    });
    input.current = (data) => {
      if (!owned || disposed) return;
      try {
        transport.sendTerminalInput(sessionId, data);
      } catch (cause) {
        report(cause);
      }
    };
    resize.current = () => {
      if (!owned || disposed) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!disposed && owned)
          void transport
            .requestTerminal({ kind: "resize", sessionId, ...size.current }, newRequestId())
            .catch(report);
      }, 150);
    };
    attach();
    return () => {
      disposed = true;
      off();
      clearTimeout(resizeTimer);
      input.current = () => undefined;
      resize.current = () => undefined;
      surface?.send({ type: "enabled", value: false });
      if (transport.state.status === "ready")
        void transport
          .requestTerminal({ kind: "detach", sessionId }, newRequestId())
          .catch(() => undefined);
    };
  }, [connection.transport, ready, sessionId, rendererVersion]);
  const action = async (operation: TerminalOperation) => {
    setBusy(true);
    setError(null);
    try {
      await request(operation);
      if (operation.kind === "claim") renderer.current?.send({ type: "focus" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Terminal request failed.");
    } finally {
      setBusy(false);
      setConfirmStop(false);
    }
  };
  const enabled = ready && connection.phase === "ready" && terminal?.status === "running";
  return (
    <KeyboardAvoidingView
      style={layout.fill}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <View style={{ flex: 1, gap: 12 }}>
        <Copy muted size={13}>
          {owner ? "You control this terminal." : "Viewing terminal. Take control to type."}{" "}
          {terminal?.status !== "running" ? terminal?.status : ""}
        </Copy>
        {error && <Notice>{error}</Notice>}
        <View style={{ flex: 1, minHeight: 120, overflow: "hidden", borderRadius: 10 }}>
          <TerminalRenderer
            key={rendererVersion}
            ref={renderer}
            onEvent={event}
            onError={() => {
              setReady(false);
              setError("Terminal renderer stopped. Reload to reconnect.");
            }}
          />
        </View>
        <View style={layout.row}>
          {(
            [
              ["Esc", "\u001b"],
              ["Tab", "\t"],
              ["Ctrl+C", "\u0003"],
              ["↑", "\u001b[A"],
              ["↓", "\u001b[B"],
              ["←", "\u001b[D"],
              ["→", "\u001b[C"],
            ] as const
          ).map(([label, data]) => (
            <Button
              key={label}
              secondary
              disabled={!enabled || !owner}
              onPress={() => input.current(data)}
            >
              {label}
            </Button>
          ))}
        </View>
        <View style={layout.row}>
          <Button
            disabled={!enabled || busy}
            onPress={() => {
              void action({ kind: "claim", sessionId, ...size.current });
            }}
          >
            {owner ? "Show keyboard" : "Take control"}
          </Button>
          <Button
            secondary
            onPress={() => {
              setReady(false);
              setRendererVersion((value) => value + 1);
              setError(null);
            }}
          >
            Reload terminal
          </Button>
          <Button
            secondary
            disabled={!enabled || busy}
            onPress={() => setConfirmStop(!confirmStop)}
          >
            Stop session
          </Button>
        </View>
        {confirmStop && (
          <Notice>
            <View style={layout.stack}>
              <Copy>This stops the process for every connected device.</Copy>
              <Button
                danger
                onPress={() => {
                  void action({ kind: "stop", sessionId });
                }}
              >
                Confirm stop
              </Button>
            </View>
          </Notice>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
