import {
  AgentRequestSchema,
  type AgentInfo,
  type AgentEvent,
  type AgentOperation,
  type AgentResult,
} from "@concors/protocol";
import {
  ProjectRequestSchema,
  type ProjectSetup,
  type ProjectOperation,
  type ProjectResult,
} from "@concors/protocol";
import {
  PROTOCOL_VERSION,
  TerminalRequestSchema,
  TerminalInputSchema,
  type TerminalEvent,
  type TerminalOperation,
  type TerminalResult,
  createProtocolError,
  parseDaemonMessage,
  type ClientHelloMessage,
  type ClientInfo,
  type DaemonInfo,
  type ProtocolError,
  type ProtocolVersion,
  type WorkspaceSnapshot,
  type WorkspaceCommand,
  type WorkspaceResult,
} from "@concors/protocol";

import type { DaemonEndpoint } from "./endpoint.ts";

/**
 * Minimal subset of the WHATWG WebSocket used by `DaemonConnection`. Browsers, React Native and
 * Node ≥ 22 all provide a compatible global `WebSocket`; tests can inject a fake.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(
    type: "close",
    listener: (event: { code: number; reason: string }) => void,
  ): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type ConnectionState =
  | { readonly status: "disconnected"; readonly reason?: string }
  | { readonly status: "connecting" }
  | { readonly status: "handshaking" }
  | { readonly status: "ready"; readonly daemon: DaemonInfo }
  | { readonly status: "error"; readonly error: ProtocolError };

export type ConnectionStateListener = (state: ConnectionState) => void;

export interface DaemonConnectionOptions {
  readonly endpoint: DaemonEndpoint;
  /** Identity presented to the daemon during the handshake. */
  readonly client: ClientInfo;
  readonly protocolVersion?: ProtocolVersion;
  /** How long to wait for `daemon.ready` after the socket opens. */
  readonly handshakeTimeoutMs?: number;
  /** Override the WebSocket implementation (tests, custom transports). */
  readonly webSocketFactory?: WebSocketFactory;
}

export class DaemonConnectionError extends Error {
  override readonly name = "DaemonConnectionError";
  readonly error: ProtocolError;

  constructor(error: ProtocolError) {
    super(`${error.code}: ${error.message}`);
    this.error = error;
  }
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;

/**
 * A single connection to one daemon, local or remote. Speaks only `@concors/protocol`.
 *
 * Lifecycle: `disconnected → connecting → handshaking → ready → disconnected`, with `error` as a
 * terminal state for a failed attempt. The class is deliberately single-shot: reconnection policy
 * (backoff, UI prompts) belongs to the host application.
 */
export class DaemonConnection {
  readonly endpoint: DaemonEndpoint;

  #state: ConnectionState = { status: "disconnected" };
  #socket: WebSocketLike | null = null;
  /** Rejects the in-flight `connect()` promise, if any. */
  #abortPending: ((error: ProtocolError) => void) | null = null;
  #workspace: WorkspaceSnapshot | null = null;
  #projectSetups: ProjectSetup[] = [];
  #agents: AgentInfo[] = [];
  readonly #agentListeners = new Set<(event: AgentEvent) => void>();
  readonly #agentRequests = new Map<
    string,
    {
      resolve: (result: AgentResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #projectListeners = new Set<(setups: ProjectSetup[]) => void>();
  readonly #projectRequests = new Map<
    string,
    {
      resolve: (result: ProjectResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #terminalListeners = new Set<(event: TerminalEvent) => void>();
  readonly #terminalRequests = new Map<
    string,
    {
      resolve: (result: TerminalResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #workspaceListeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  readonly #commands = new Map<
    string,
    {
      resolve: (result: WorkspaceResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #listeners = new Set<ConnectionStateListener>();
  readonly #client: ClientInfo;
  readonly #protocolVersion: ProtocolVersion;
  readonly #handshakeTimeoutMs: number;
  readonly #createSocket: WebSocketFactory;

  constructor(options: DaemonConnectionOptions) {
    this.endpoint = options.endpoint;
    this.#client = options.client;
    this.#protocolVersion = options.protocolVersion ?? PROTOCOL_VERSION;
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.#createSocket = options.webSocketFactory ?? defaultWebSocketFactory;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get workspace(): WorkspaceSnapshot | null {
    return this.#workspace;
  }

  /** A subscription always refreshes from the daemon; cached state is never a write authority. */
  subscribeWorkspace(listener: (snapshot: WorkspaceSnapshot) => void): () => void {
    const first = this.#workspaceListeners.size === 0;
    this.#workspaceListeners.add(listener);
    if (this.#workspace) listener(this.#workspace);
    if (first && this.#state.status === "ready")
      this.#socket?.send(JSON.stringify({ type: "workspace.subscribe" }));
    return () => {
      this.#workspaceListeners.delete(listener);
    };
  }

  /** Retrying an uncertain outcome must reuse this exact command, including its ID. */
  executeWorkspace(command: WorkspaceCommand): Promise<WorkspaceResult> {
    if (this.#state.status !== "ready" || !this.#workspace || this.#workspaceListeners.size === 0)
      return Promise.reject(new Error("Workspace is not connected"));
    if (this.#commands.has(command.commandId))
      return Promise.reject(new Error("Command is already pending"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#commands.delete(command.commandId);
        reject(new Error("Workspace command timed out; refresh or retry the same command ID"));
      }, 10_000);
      this.#commands.set(command.commandId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(command));
      } catch (error) {
        clearTimeout(timer);
        this.#commands.delete(command.commandId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  subscribeProjectSetups(listener: (setups: ProjectSetup[]) => void): () => void {
    this.#projectListeners.add(listener);
    listener(this.#projectSetups);
    return () => {
      this.#projectListeners.delete(listener);
    };
  }
  requestProject(operation: ProjectOperation, requestId: string): Promise<ProjectResult> {
    if (this.#state.status !== "ready" || !this.#workspace)
      return Promise.reject(new Error("Workspace is disconnected"));
    const request = ProjectRequestSchema.parse({ type: "project.request", requestId, operation });
    if (this.#projectRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#projectRequests.delete(requestId);
        reject(new Error("Request timed out; check project setup history before retrying"));
      }, 10000);
      this.#projectRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#projectRequests.delete(requestId);
        reject(error);
      }
    });
  }

  get agents(): AgentInfo[] {
    return this.#agents;
  }
  onAgent(listener: (event: AgentEvent) => void): () => void {
    this.#agentListeners.add(listener);
    listener({ type: "agent.list", agents: this.#agents });
    return () => {
      this.#agentListeners.delete(listener);
    };
  }
  requestAgent(operation: AgentOperation, requestId: string): Promise<AgentResult> {
    if (this.#state.status !== "ready" || !this.#workspace)
      return Promise.reject(new Error("Workspace is disconnected"));
    const request = AgentRequestSchema.parse({ type: "agent.request", requestId, operation });
    if (this.#agentRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#agentRequests.delete(requestId);
        reject(
          new Error(
            "Agent request timed out. Reconnect and check the conversation before retrying with the same request ID.",
          ),
        );
      }, 35000);
      this.#agentRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#agentRequests.delete(requestId);
        reject(error);
      }
    });
  }

  onTerminal(listener: (event: TerminalEvent) => void): () => void {
    this.#terminalListeners.add(listener);
    return () => {
      this.#terminalListeners.delete(listener);
    };
  }

  requestTerminal(operation: TerminalOperation, requestId: string): Promise<TerminalResult> {
    if (this.#state.status !== "ready" || !this.#workspace)
      return Promise.reject(new Error("Workspace is not connected"));
    const request = TerminalRequestSchema.parse({ type: "terminal.request", requestId, operation });
    if (this.#terminalRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#terminalRequests.delete(requestId);
        reject(new Error("Terminal request timed out; retry launches with the same request ID"));
      }, 10_000);
      this.#terminalRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#terminalRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  sendTerminalInput(sessionId: string, data: string): void {
    if (this.#state.status !== "ready") throw new Error("Terminal is disconnected");
    this.#socket?.send(
      JSON.stringify(TerminalInputSchema.parse({ type: "terminal.input", sessionId, data })),
    );
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: ConnectionStateListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Opens the socket and performs the handshake. Resolves with the daemon's self-description once
   * `daemon.ready` is received; rejects with `DaemonConnectionError` otherwise.
   */
  connect(): Promise<DaemonInfo> {
    if (this.#socket !== null) {
      return Promise.reject(
        new DaemonConnectionError(
          createProtocolError("INTERNAL_ERROR", "connect() called while already connected"),
        ),
      );
    }

    this.#setState({ status: "connecting" });

    return new Promise<DaemonInfo>((resolve, reject) => {
      let settled = false;
      let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
      let socket: WebSocketLike | null = null;

      /** Events from a socket that has been torn down (e.g. after `disconnect()`) are stale. */
      const isCurrent = (): boolean => socket !== null && this.#socket === socket;

      const settleReject = (error: ProtocolError): void => {
        clearTimeout(handshakeTimer);
        if (!settled) {
          settled = true;
          this.#abortPending = null;
          reject(new DaemonConnectionError(error));
        }
      };
      this.#abortPending = settleReject;

      const fail = (error: ProtocolError): void => {
        settleReject(error);
        this.#setState({ status: "error", error });
        this.#teardown(1002, error.code);
      };

      try {
        socket = this.#createSocket(this.endpoint.url);
      } catch (cause) {
        fail(createProtocolError("INTERNAL_ERROR", `Could not open WebSocket: ${String(cause)}`));
        return;
      }
      this.#socket = socket;

      socket.addEventListener("open", () => {
        if (!isCurrent() || socket === null) return;
        this.#setState({ status: "handshaking" });
        const hello: ClientHelloMessage = {
          type: "client.hello",
          protocolVersion: this.#protocolVersion,
          client: this.#client,
        };
        socket.send(JSON.stringify(hello));
        handshakeTimer = setTimeout(() => {
          fail(
            createProtocolError(
              "HANDSHAKE_TIMEOUT",
              `Daemon did not complete the handshake within ${this.#handshakeTimeoutMs}ms`,
            ),
          );
        }, this.#handshakeTimeoutMs);
      });

      socket.addEventListener("message", (event) => {
        if (!isCurrent()) return;
        const parsed = parseDaemonMessage(event.data);
        if (!parsed.success) {
          if (this.#state.status === "handshaking") {
            fail(
              createProtocolError("INVALID_MESSAGE", "Daemon sent an invalid message", {
                issues: parsed.error.issues,
              }),
            );
          }
          // After the handshake, unknown/extra messages are ignored for forward compatibility.
          return;
        }

        const message = parsed.data;
        switch (message.type) {
          case "daemon.ready": {
            clearTimeout(handshakeTimer);
            const daemon: DaemonInfo = {
              protocolVersion: message.protocolVersion,
              daemonVersion: message.daemonVersion,
              status: message.status,
              ...(message.capabilities ? { capabilities: message.capabilities } : {}),
            };
            this.#setState({ status: "ready", daemon });
            if (this.#workspaceListeners.size > 0)
              socket?.send(JSON.stringify({ type: "workspace.subscribe" }));
            if (!settled) {
              settled = true;
              this.#abortPending = null;
              resolve(daemon);
            }
            break;
          }
          case "agent.list":
          case "agent.state":
          case "agent.item":
            if (this.#state.status !== "ready") break;
            if (message.type === "agent.list") this.#agents = message.agents;
            if (message.type === "agent.state") {
              const prior = this.#agents.find((a) => a.id === message.agent.id);
              if (prior && prior.revision > message.agent.revision) break;
              this.#agents = [
                ...this.#agents.filter((a) => a.id !== message.agent.id),
                message.agent,
              ];
            }
            for (const listener of this.#agentListeners) listener(message);
            break;
          case "agent.result": {
            const pending = this.#agentRequests.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#agentRequests.delete(message.requestId);
              pending.resolve(message);
            }
            break;
          }
          case "project.setups":
            if (this.#state.status === "ready") {
              this.#projectSetups = message.setups;
              for (const listener of this.#projectListeners) listener(message.setups);
            }
            break;
          case "project.result": {
            const pending = this.#projectRequests.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#projectRequests.delete(message.requestId);
              pending.resolve(message);
            }
            break;
          }
          case "terminal.result": {
            const pending = this.#terminalRequests.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#terminalRequests.delete(message.requestId);
              pending.resolve(message);
            }
            break;
          }
          case "terminal.snapshot":
          case "terminal.output":
          case "terminal.state":
          case "terminal.owner":
          case "terminal.error":
            if (this.#state.status === "ready")
              for (const listener of this.#terminalListeners) listener(message);
            break;
          case "workspace.snapshot":
            if (this.#state.status !== "ready") break;
            if (
              this.#workspace?.epoch === message.snapshot.epoch &&
              this.#workspace.revision > message.snapshot.revision
            )
              break;
            this.#workspace = message.snapshot;
            for (const listener of this.#workspaceListeners) listener(message.snapshot);
            break;
          case "workspace.result": {
            const pending = this.#commands.get(message.commandId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#commands.delete(message.commandId);
              pending.resolve(message);
            }
            break;
          }
          case "error":
            fail(message.error);
            break;
        }
      });

      socket.addEventListener("error", () => {
        // The WHATWG event carries no detail; the subsequent `close` event has the code.
        if (isCurrent() && this.#state.status === "connecting") {
          fail(
            createProtocolError("INTERNAL_ERROR", `Could not reach daemon at ${this.endpoint.url}`),
          );
        }
      });

      socket.addEventListener("close", (event) => {
        const wasCurrent = isCurrent();
        if (wasCurrent) this.#socket = null;

        if (!settled) {
          // Closed before daemon.ready: the connect() attempt failed. If the host already moved us
          // to a terminal state (disconnect() / fail()), keep it; otherwise record the error.
          const error = createProtocolError(
            "INTERNAL_ERROR",
            `Connection closed before handshake completed (code ${event.code})`,
          );
          if (wasCurrent) this.#setState({ status: "error", error });
          settleReject(error);
          return;
        }

        if (wasCurrent && this.#state.status === "ready") {
          this.#setState({
            status: "disconnected",
            reason: event.reason || `closed (${event.code})`,
          });
        }
      });
    });
  }

  /** Closes the connection. Safe to call in any state; a pending `connect()` rejects. */
  disconnect(): void {
    this.#teardown(1000, "client disconnect");
    if (this.#state.status !== "disconnected") {
      this.#setState({ status: "disconnected", reason: "client disconnect" });
    }
    this.#abortPending?.(
      createProtocolError("INTERNAL_ERROR", "Disconnected by client before handshake completed"),
    );
  }

  #teardown(code: number, reason: string): void {
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      try {
        socket.close(code, reason);
      } catch {
        // Closing an already-closed socket is not an error we care about.
      }
    }
  }

  #setState(state: ConnectionState): void {
    this.#state = state;
    if (state.status !== "ready") {
      this.#workspace = null;
      for (const pending of this.#agentRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(
            "Connection lost; check the conversation after reconnecting. Prompts are never resent automatically.",
          ),
        );
      }
      this.#agentRequests.clear();
      for (const pending of this.#commands.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(
            "Connection lost; command outcome may be unknown. Retry with the same command ID.",
          ),
        );
      }
      this.#commands.clear();
      for (const pending of this.#terminalRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Connection lost; terminal launch outcome may be unknown"));
      }
      this.#terminalRequests.clear();
      for (const pending of this.#projectRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Connection lost; check setup history after reconnecting"));
      }
      this.#projectRequests.clear();
    }
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  if (typeof WebSocket === "undefined") {
    throw new Error("No global WebSocket implementation available; pass `webSocketFactory`.");
  }
  return new WebSocket(url);
}
