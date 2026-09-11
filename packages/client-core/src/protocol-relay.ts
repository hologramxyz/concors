import type { DaemonConnection } from "@concors/daemon-client";
import { parseClientMessage, PROTOCOL_VERSION, type DaemonMessage } from "@concors/protocol";
import { newRequestId } from "./connection.ts";

/**
 * An offline UI can use the real DaemonConnection through this protocol-only relay.
 * The native host retains the authenticated socket, tokens, tickets and lifecycle.
 * Disposal removes observers and detaches viewers; it never stops machine processes.
 */
export type RelayConnection = Pick<
  DaemonConnection,
  | "state"
  | "workspace"
  | "terminals"
  | "subscribeWorkspace"
  | "onAgent"
  | "onTerminal"
  | "subscribeProjectSetups"
  | "subscribeHostUsage"
  | "executeWorkspace"
  | "requestAgent"
  | "requestProject"
  | "requestFile"
  | "requestProvider"
  | "requestTerminal"
  | "sendTerminalInput"
>;
export function createProtocolRelay(
  connection: RelayConnection,
  deliver: (message: DaemonMessage) => void,
) {
  let disposed = false;
  let started = false;
  let unsubscribeUsage: (() => void) | undefined;
  const subscriptions: (() => void)[] = [];
  const viewers = new Set<string>();
  const emit = (message: DaemonMessage) => {
    if (!disposed) deliver(message);
  };
  const detach = (sessionId: string) => {
    if (connection.state.status === "ready")
      void connection
        .requestTerminal({ kind: "detach", sessionId }, newRequestId())
        .catch(() => undefined);
  };
  return {
    async receive(raw: unknown): Promise<void> {
      if (disposed) return;
      const parsed = parseClientMessage(raw);
      if (!parsed.success) throw new Error("Invalid embedded protocol message");
      if (connection.state.status !== "ready") throw new Error("Machine is disconnected");
      const message = parsed.data;
      if (message.type === "client.hello") {
        if (started) return;
        if (message.protocolVersion !== PROTOCOL_VERSION)
          throw new Error("Unsupported embedded protocol version");
        started = true;
        emit({ type: "daemon.ready", ...connection.state.daemon });
        subscriptions.push(
          connection.subscribeWorkspace((snapshot) =>
            emit({ type: "workspace.snapshot", snapshot }),
          ),
          connection.onAgent(emit),
          connection.onTerminal(emit),
          connection.subscribeProjectSetups((setups) => emit({ type: "project.setups", setups })),
        );
        for (const session of connection.terminals) emit({ type: "terminal.state", session });
        return;
      }
      if (!started) throw new Error("Embedded protocol handshake is required");
      switch (message.type) {
        case "host.subscribe":
          if (message.enabled) {
            unsubscribeUsage ??= connection.subscribeHostUsage((usage) =>
              emit({ type: "host.usage", usage }),
            );
          } else {
            unsubscribeUsage?.();
            unsubscribeUsage = undefined;
          }
          break;
        case "workspace.subscribe":
          if (connection.workspace)
            emit({ type: "workspace.snapshot", snapshot: connection.workspace });
          break;
        case "workspace.command":
          emit(await connection.executeWorkspace(message));
          break;
        case "agent.request":
          emit(await connection.requestAgent(message.operation, message.requestId));
          break;
        case "project.request":
          emit(await connection.requestProject(message.operation, message.requestId));
          break;
        case "provider.request":
          emit(await connection.requestProvider(message.operation, message.requestId));
          break;
        case "file.request":
          emit(await connection.requestFile(message.operation, message.requestId));
          break;
        case "terminal.request": {
          const operation = message.operation;
          if (operation.kind === "attach") viewers.add(operation.sessionId);
          if (operation.kind === "detach") viewers.delete(operation.sessionId);
          const result = await connection.requestTerminal(operation, message.requestId);
          if (disposed && operation.kind === "attach") detach(operation.sessionId);
          emit(result);
          break;
        }
        case "terminal.input":
          if (!viewers.has(message.sessionId))
            throw new Error("Attach before sending terminal input");
          connection.sendTerminalInput(message.sessionId, message.data);
          break;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeUsage?.();
      for (const unsubscribe of subscriptions) unsubscribe();
      for (const sessionId of viewers) detach(sessionId);
      viewers.clear();
    },
  };
}
