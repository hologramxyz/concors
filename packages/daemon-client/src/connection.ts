import {
  SCHEDULES_CAPABILITY,
  ScheduleRequestSchema,
  type AgentSchedule,
  type ScheduleOperation,
  type ScheduleResult,
} from "@concors/protocol";
import { ThemeRequestSchema, type ThemeResult } from "@concors/protocol";
import { AUTH_REFRESH_CAPABILITY } from "@concors/protocol";
import {
  DICTATION_CAPABILITY,
  DictationAudioSchema,
  DictationRequestSchema,
  type DictationEvent,
  type DictationModel,
  type DictationOperation,
  type DictationResult,
} from "@concors/protocol";
import {
  RESOURCES_CAPABILITY,
  ResourceRequestSchema,
  type ProcessPreview,
  type ResourceOperation,
  type ResourceResult,
} from "@concors/protocol";
import {
  ProviderRequestSchema,
  type ProviderOperation,
  type ProviderResult,
} from "@concors/protocol";
import { FileRequestSchema, type FileOperation, type FileResult } from "@concors/protocol";
import {
  PULL_REQUESTS_CAPABILITY,
  PULL_REQUEST_ACTIONS_CAPABILITY,
  PULL_REQUEST_STATES_CAPABILITY,
  PullRequestRequestSchema,
  type PullRequestOperation,
  type PullRequestResult,
} from "@concors/protocol";
import {
  AGENT_USAGE_CAPABILITY,
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
  HOST_USAGE_CAPABILITY,
  type HostUsage,
  TerminalRequestSchema,
  TerminalInputSchema,
  type TerminalEvent,
  type TerminalInfo,
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
/** How often a request still uploading checks whether its bytes have left the socket. */
const UPLOAD_POLL_MS = 250;

export interface WebSocketLike {
  readonly readyState: number;
  /** Bytes queued by `send` that have not reached the network yet (absent in some test doubles). */
  readonly bufferedAmount?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(
    type: "close",
    listener: (event: { code: number; reason: string }) => void,
  ): void;
}

export type WebSocketFactory = (url: string, protocols?: string | string[]) => WebSocketLike;

export type ConnectionState =
  | { readonly status: "disconnected"; readonly reason?: string; readonly closeCode?: number }
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
  /** Authentication subprotocols stay in the host transport, never in the endpoint URL. */
  readonly protocols?: string | readonly string[];
  /** Preview routing supplied by simulated or path-hosted transports. */
  readonly previewUrl?: (preview: ProcessPreview) => string | null;
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
 * terminal state for a failed attempt. Once an attempt has ended, `connect()` may be called again
 * on the same instance so subscribers stay attached across a reconnect; reconnection policy
 * (backoff, UI prompts) belongs to the host application.
 */
export class DaemonConnection {
  readonly #resourceRequests = new Map<
    string,
    {
      resolve: (result: ResourceResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  requestResource(operation: ResourceOperation, requestId: string): Promise<ResourceResult> {
    if (this.#state.status !== "ready" || !this.#workspace)
      return Promise.reject(new Error("Workspace is disconnected"));
    if (!this.#state.daemon.capabilities?.includes(RESOURCES_CAPABILITY))
      return Promise.reject(new Error("Update the machine daemon to inspect processes."));
    if (this.#resourceRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    const request = ResourceRequestSchema.parse({ type: "resource.request", requestId, operation });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.#resourceRequests.delete(requestId);
          reject(
            new Error(
              "Resource request timed out. Refresh before retrying; a stop request may have completed.",
            ),
          );
        },
        operation.kind === "processes" ? 10_000 : 60_000,
      );
      this.#resourceRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#resourceRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  readonly #pullRequestRequests = new Map<
    string,
    {
      resolve: (result: PullRequestResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  requestPullRequests(
    operation: PullRequestOperation,
    requestId: string,
  ): Promise<PullRequestResult> {
    if (this.#state.status !== "ready" || !this.#workspace)
      return Promise.reject(new Error("Workspace is disconnected"));
    if (!this.#state.daemon.capabilities?.includes(PULL_REQUESTS_CAPABILITY))
      return Promise.reject(new Error("Update the machine daemon to see pull requests."));
    if (
      operation.kind !== "list" &&
      !this.#state.daemon.capabilities.includes(PULL_REQUEST_ACTIONS_CAPABILITY)
    )
      return Promise.reject(new Error("Update the machine daemon to manage pull requests."));
    if (
      operation.kind === "list" &&
      operation.state &&
      operation.state !== "open" &&
      !this.#state.daemon.capabilities.includes(PULL_REQUEST_STATES_CAPABILITY)
    )
      return Promise.reject(
        new Error("Update the machine daemon to see merged and closed pull requests."),
      );
    if (this.#pullRequestRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    const request = PullRequestRequestSchema.parse({
      type: "pull-request.request",
      requestId,
      operation,
    });
    return new Promise((resolve, reject) => {
      // Discovery plus a GitHub round trip for every uncached repository.
      const timer = setTimeout(() => {
        this.#pullRequestRequests.delete(requestId);
        reject(
          new Error(
            operation.kind === "list" || operation.kind === "detail"
              ? "GitHub took too long to answer. Pull requests will refresh shortly."
              : "GitHub took too long to answer. Refresh to see whether the change was applied.",
          ),
        );
      }, 45_000);
      this.#pullRequestRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#pullRequestRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  readonly #dictationRequests = new Map<
    string,
    {
      resolve: (result: DictationResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #dictationListeners = new Set<(event: DictationEvent) => void>();
  #dictationModel: DictationModel | null = null;

  /** Whether this daemon transcribes dictation itself (older daemons do not). */
  get dictation(): boolean {
    return (
      this.#state.status === "ready" &&
      !!this.#state.daemon.capabilities?.includes(DICTATION_CAPABILITY)
    );
  }

  /** The latest speech-model state the daemon reported, or null before it has said. */
  get dictationModel(): DictationModel | null {
    return this.#dictationModel;
  }

  onDictation(listener: (event: DictationEvent) => void): () => void {
    this.#dictationListeners.add(listener);
    return () => {
      this.#dictationListeners.delete(listener);
    };
  }

  requestDictation(operation: DictationOperation, requestId: string): Promise<DictationResult> {
    if (!this.dictation) return Promise.reject(new Error("Dictation is not available here"));
    if (this.#dictationRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    const request = DictationRequestSchema.parse({
      type: "dictation.request",
      requestId,
      operation,
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#dictationRequests.delete(requestId);
        reject(new Error("The machine did not answer. Try dictating again."));
      }, 10_000);
      this.#dictationRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#dictationRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Fire-and-forget: a lost chunk surfaces as a `dictation.error` for that recording. */
  sendDictationAudio(dictationId: string, seq: number, pcm: string): void {
    if (!this.dictation) throw new Error("Dictation is not available here");
    this.#socket?.send(
      JSON.stringify(
        DictationAudioSchema.parse({ type: "dictation.audio", dictationId, seq, pcm }),
      ),
    );
  }

  #hostUsage: HostUsage | null = null;
  readonly #hostUsageListeners = new Set<(usage: HostUsage | null) => void>();

  /** Shared opt-in stream. Older daemons receive no unsupported subscription messages. */
  subscribeHostUsage(listener: (usage: HostUsage | null) => void): () => void {
    const first = this.#hostUsageListeners.size === 0;
    this.#hostUsageListeners.add(listener);
    listener(this.#hostUsage);
    if (first) this.#subscribeHostUsage(true);
    return () => {
      this.#hostUsageListeners.delete(listener);
      if (!this.#hostUsageListeners.size) {
        this.#subscribeHostUsage(false);
        this.#hostUsage = null;
      }
    };
  }

  #subscribeHostUsage(enabled: boolean): void {
    if (
      this.#state.status === "ready" &&
      this.#state.daemon.capabilities?.includes(HOST_USAGE_CAPABILITY)
    )
      this.#socket?.send(JSON.stringify({ type: "host.subscribe", enabled }));
  }
  readonly endpoint: DaemonEndpoint;

  #state: ConnectionState = { status: "disconnected" };
  #socket: WebSocketLike | null = null;
  #lastMessageAt = 0;
  #authRefresh: ((ok: boolean) => void) | null = null;
  /**
   * Agents and terminals seen since the last `workspace.subscribe`. The daemon answers with
   * `agent.list []`, per-item states, then the snapshot; replicas keep their previous contents
   * until the snapshot so a resubscribe (reconnect) never shows empty lists in between.
   */
  #resync: { agents: Set<string>; terminals: Set<string> } | null = null;
  /** Rejects the in-flight `connect()` promise, if any. */
  #abortPending: ((error: ProtocolError) => void) | null = null;
  #workspace: WorkspaceSnapshot | null = null;
  #projectSetups: ProjectSetup[] = [];
  #agents: AgentInfo[] = [];
  #schedules: AgentSchedule[] | null = null;
  readonly #scheduleListeners = new Set<(schedules: AgentSchedule[] | null) => void>();
  readonly #scheduleRequests = new Map<
    string,
    {
      resolve: (result: ScheduleResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #terminals: TerminalInfo[] = [];
  readonly #terminalSessionListeners = new Set<() => void>();
  readonly #agentListeners = new Set<(event: AgentEvent) => void>();
  readonly #agentRequests = new Map<
    string,
    {
      resolve: (result: AgentResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout> | undefined;
    }
  >();
  readonly #fileRequests = new Map<
    string,
    {
      resolve: (result: FileResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #providerRequests = new Map<
    string,
    {
      resolve: (result: ProviderResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #themeRequests = new Map<
    string,
    {
      resolve: (result: ThemeResult) => void;
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
  #protocols: string | string[] | undefined;
  readonly #previewUrl: ((preview: ProcessPreview) => string | null) | undefined;
  readonly #createSocket: WebSocketFactory;

  constructor(options: DaemonConnectionOptions) {
    this.endpoint = options.endpoint;
    this.#client = options.client;
    this.#protocolVersion = options.protocolVersion ?? PROTOCOL_VERSION;
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.#protocols =
      typeof options.protocols === "string" ? options.protocols : options.protocols?.slice();
    this.#previewUrl = options.previewUrl;
    this.#createSocket = options.webSocketFactory ?? defaultWebSocketFactory;
  }

  /** A browser URL for a daemon-confirmed preview. Remote credentials stay in the fragment. */
  previewUrl(preview: ProcessPreview): string | null {
    if (this.#previewUrl) return this.#previewUrl(preview);
    const daemon = new URL(this.endpoint.url);
    if (this.endpoint.kind === "local") return `${preview.protocol}://127.0.0.1:${preview.port}/`;
    if (daemon.protocol !== "wss:" || daemon.pathname !== "/ws") return null;
    const protocols =
      typeof this.#protocols === "string" ? [this.#protocols] : (this.#protocols ?? []);
    const bearer = protocols.find((value) => value.startsWith("concors.bearer."));
    if (!bearer) return null;
    const label = preview.protocol === "https" ? `https-${preview.port}` : String(preview.port);
    const url = new URL(`https://${label}.${daemon.hostname}/`);
    url.hash = new URLSearchParams({
      access_token: bearer.slice("concors.bearer.".length),
    }).toString();
    return url.href;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  /** Whether this socket can renew its access in place (a managed gateway advertises it). */
  get canRefreshAuthorization(): boolean {
    return (
      this.#state.status === "ready" &&
      !!this.#state.daemon.capabilities?.includes(AUTH_REFRESH_CAPABILITY)
    );
  }

  /**
   * Hands a freshly minted token to the gateway on the live socket. Resolves `false` when the
   * gateway refuses it, cannot be asked, or does not answer; the socket then expires as before.
   */
  refreshAuthorization(token: string): Promise<boolean> {
    if (!this.canRefreshAuthorization || this.#authRefresh) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(false), 10_000);
      const settle = (ok: boolean) => {
        clearTimeout(timer);
        this.#authRefresh = null;
        if (ok) this.#protocols = [`concors.bearer.${token}`];
        resolve(ok);
      };
      this.#authRefresh = settle;
      try {
        this.#socket?.send(JSON.stringify({ type: "auth.refresh", token }));
      } catch {
        settle(false);
      }
    });
  }

  /** When the current socket last delivered anything; a liveness hint for flaky networks. */
  get lastMessageAt(): number {
    return this.#lastMessageAt;
  }

  get terminals(): readonly TerminalInfo[] {
    return this.#terminals;
  }

  subscribeTerminalSessions(listener: () => void): () => void {
    this.#terminalSessionListeners.add(listener);
    return () => {
      this.#terminalSessionListeners.delete(listener);
    };
  }

  private updateTerminal(session: TerminalInfo): void {
    this.#terminals = [...this.#terminals.filter((item) => item.id !== session.id), session];
    for (const listener of this.#terminalSessionListeners) listener();
  }

  get workspace(): WorkspaceSnapshot | null {
    return this.#workspace;
  }

  /** A subscription always refreshes from the daemon; cached state is never a write authority. */
  subscribeWorkspace(listener: (snapshot: WorkspaceSnapshot) => void): () => void {
    const first = this.#workspaceListeners.size === 0;
    this.#workspaceListeners.add(listener);
    if (this.#workspace) listener(this.#workspace);
    if (first && this.#state.status === "ready") this.#subscribeWorkspace();
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

  requestFile(operation: FileOperation, requestId: string): Promise<FileResult> {
    if (this.#state.status !== "ready" || !this.#workspace)
      return Promise.reject(new Error("Workspace is disconnected"));
    const request = FileRequestSchema.parse({ type: "file.request", requestId, operation });
    if (this.#fileRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#fileRequests.delete(requestId);
        reject(new Error("File request timed out. Reload from disk before retrying a save."));
      }, 10000);
      this.#fileRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#fileRequests.delete(requestId);
        reject(error);
      }
    });
  }

  requestProvider(operation: ProviderOperation, requestId: string): Promise<ProviderResult> {
    if (this.#state.status !== "ready" || !this.#workspace)
      return Promise.reject(new Error("Workspace is disconnected"));
    const request = ProviderRequestSchema.parse({ type: "provider.request", requestId, operation });
    if (this.#providerRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.#providerRequests.delete(requestId);
          reject(new Error("Provider request timed out. Reload settings before retrying."));
        },
        // Session discovery may start a CLI; the daemon gives it 15 seconds before answering.
        operation.kind === "usage" || operation.kind === "sessions-list" ? 20000 : 10000,
      );
      this.#providerRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#providerRequests.delete(requestId);
        reject(error);
      }
    });
  }

  get schedules(): AgentSchedule[] | null {
    return this.#schedules;
  }
  onSchedules(listener: (schedules: AgentSchedule[] | null) => void): () => void {
    this.#scheduleListeners.add(listener);
    listener(this.#schedules);
    return () => {
      this.#scheduleListeners.delete(listener);
    };
  }
  requestSchedule(operation: ScheduleOperation, requestId: string): Promise<ScheduleResult> {
    if (this.#state.status !== "ready" || !this.#workspace)
      return Promise.reject(new Error("Machine is disconnected"));
    if (!this.#state.daemon.capabilities?.includes(SCHEDULES_CAPABILITY))
      return Promise.reject(new Error("Update the daemon on this machine to use schedules"));
    const request = ScheduleRequestSchema.parse({ type: "schedule.request", requestId, operation });
    if (this.#scheduleRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#scheduleRequests.delete(requestId);
        reject(new Error("Schedule request timed out. Check Schedules before retrying."));
      }, 15000);
      this.#scheduleRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#scheduleRequests.delete(requestId);
        reject(error);
      }
    });
  }

  requestThemes(requestId: string): Promise<ThemeResult> {
    if (this.#state.status !== "ready" || !this.#workspace)
      return Promise.reject(new Error("Workspace is disconnected"));
    const request = ThemeRequestSchema.parse({ type: "theme.request", requestId });
    if (this.#themeRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#themeRequests.delete(requestId);
        reject(new Error("Theme request timed out. Reload settings before retrying."));
      }, 10000);
      this.#themeRequests.set(requestId, { resolve, reject, timer });
      try {
        this.#socket?.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#themeRequests.delete(requestId);
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
    if (
      operation.kind === "usage" &&
      !this.#state.daemon.capabilities?.includes(AGENT_USAGE_CAPABILITY)
    )
      return Promise.reject(new Error("Update the machine daemon to see plan usage."));
    const request = AgentRequestSchema.parse({ type: "agent.request", requestId, operation });
    if (this.#agentRequests.has(requestId))
      return Promise.reject(new Error("Request is already pending"));
    return new Promise((resolve, reject) => {
      const timeout =
        operation.kind === "provider-catalog" || operation.kind === "switch-provider"
          ? 100000
          : 35000;
      const pending = {
        resolve,
        reject,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      const expire = () => {
        if (this.#agentRequests.get(requestId) !== pending) return;
        this.#agentRequests.delete(requestId);
        reject(
          new Error(
            "Agent request timed out. Reconnect and check the conversation before retrying with the same request ID.",
          ),
        );
      };
      this.#agentRequests.set(requestId, pending);
      const socket = this.#socket;
      try {
        socket?.send(JSON.stringify(request));
      } catch (error) {
        this.#agentRequests.delete(requestId);
        reject(error);
        return;
      }
      // The daemon can only answer once the whole request has arrived, and a prompt with
      // attachments can take a while to upload on a slow link. Count from when the socket has
      // sent it; an upload that stops moving for as long still times out.
      let queued = socket?.bufferedAmount ?? 0,
        movedAt = Date.now();
      const sent = () => {
        if (this.#agentRequests.get(requestId) !== pending) return;
        const left = socket === this.#socket ? (socket?.bufferedAmount ?? 0) : 0;
        if (left === 0) {
          pending.timer = setTimeout(expire, timeout);
          return;
        }
        if (left < queued) movedAt = Date.now();
        queued = left;
        if (Date.now() - movedAt >= timeout) expire();
        else pending.timer = setTimeout(sent, UPLOAD_POLL_MS);
      };
      sent();
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
   * `daemon.ready` is received; rejects with `DaemonConnectionError` otherwise. `protocols`
   * replaces the authentication subprotocols for this and later attempts (e.g. a fresh token).
   */
  connect(protocols?: string | readonly string[]): Promise<DaemonInfo> {
    if (this.#socket !== null) {
      return Promise.reject(
        new DaemonConnectionError(
          createProtocolError("INTERNAL_ERROR", "connect() called while already connected"),
        ),
      );
    }

    if (protocols !== undefined)
      this.#protocols = typeof protocols === "string" ? protocols : protocols.slice();
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
        socket = this.#createSocket(this.endpoint.url, this.#protocols);
      } catch (cause) {
        fail(
          createProtocolError("INTERNAL_ERROR", "Could not open WebSocket", {
            ...(cause && typeof cause === "object" && "status" in cause
              ? { status: cause.status }
              : {}),
          }),
        );
        return;
      }
      this.#socket = socket;

      socket.addEventListener("open", () => {
        if (!isCurrent() || socket === null) return;
        this.#setState({ status: "handshaking" });
        const hello: ClientHelloMessage = {
          type: "client.hello",
          capabilities: ["agent-providers-v2", SCHEDULES_CAPABILITY, DICTATION_CAPABILITY],
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
        this.#lastMessageAt = Date.now();
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
            if (this.#hostUsageListeners.size > 0) this.#subscribeHostUsage(true);
            if (this.#workspaceListeners.size > 0) this.#subscribeWorkspace();
            else this.#forgetSessions();
            if (!settled) {
              settled = true;
              this.#abortPending = null;
              resolve(daemon);
            }
            break;
          }
          case "auth.refreshed":
            this.#authRefresh?.(message.ok);
            break;
          case "host.usage":
            if (this.#state.status === "ready" && this.#hostUsageListeners.size > 0) {
              this.#hostUsage = message.usage;
              for (const listener of this.#hostUsageListeners) listener(message.usage);
            }
            break;
          case "schedule.list":
            if (this.#state.status === "ready") {
              this.#schedules = message.schedules;
              for (const listener of this.#scheduleListeners) listener(this.#schedules);
            }
            break;
          case "schedule.result": {
            const pending = this.#scheduleRequests.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#scheduleRequests.delete(message.requestId);
              pending.resolve(message);
            }
            break;
          }
          case "agent.list":
          case "agent.state":
          case "agent.item":
            if (this.#state.status !== "ready") break;
            if (message.type === "agent.list") {
              if (this.#resync) {
                for (const agent of message.agents) this.#resync.agents.add(agent.id);
                this.#agents = [
                  ...this.#agents.filter((a) => !message.agents.some((b) => b.id === a.id)),
                  ...message.agents,
                ];
                break;
              }
              this.#agents = message.agents;
            }
            if (message.type === "agent.state") {
              const prior = this.#agents.find((a) => a.id === message.agent.id);
              // A restarted daemon may count revisions from scratch; its resync is authoritative.
              const resynced = this.#resync?.agents.has(message.agent.id) === false;
              this.#resync?.agents.add(message.agent.id);
              if (prior && !resynced && prior.revision > message.agent.revision) break;
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
          case "dictation.result": {
            const pending = this.#dictationRequests.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#dictationRequests.delete(message.requestId);
              if (message.outcome.status === "ok") this.#dictationModel = message.outcome.model;
              pending.resolve(message);
            }
            break;
          }
          case "dictation.model":
          case "dictation.transcript":
          case "dictation.error":
            if (this.#state.status !== "ready") break;
            if (message.type === "dictation.model") this.#dictationModel = message.model;
            for (const listener of this.#dictationListeners) listener(message);
            break;
          case "project.setups":
            if (this.#state.status === "ready") {
              this.#projectSetups = message.setups;
              for (const listener of this.#projectListeners) listener(message.setups);
            }
            break;
          case "resource.result": {
            const pending = this.#resourceRequests.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#resourceRequests.delete(message.requestId);
              pending.resolve(message);
            }
            break;
          }
          case "pull-request.result": {
            const pending = this.#pullRequestRequests.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#pullRequestRequests.delete(message.requestId);
              pending.resolve(message);
            }
            break;
          }
          case "file.result": {
            const pending = this.#fileRequests.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#fileRequests.delete(message.requestId);
              pending.resolve(message);
            }
            break;
          }
          case "provider.result": {
            const pending = this.#providerRequests.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#providerRequests.delete(message.requestId);
              pending.resolve(message);
            }
            break;
          }
          case "theme.result": {
            const pending = this.#themeRequests.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              this.#themeRequests.delete(message.requestId);
              pending.resolve(message);
            }
            break;
          }
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
            if (this.#state.status === "ready" && message.outcome.status === "ok")
              for (const session of message.outcome.sessions) this.updateTerminal(session);
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
            if (this.#state.status === "ready") {
              if (message.type === "terminal.state" || message.type === "terminal.snapshot") {
                this.#resync?.terminals.add(message.session.id);
                this.updateTerminal(message.session);
              }
              for (const listener of this.#terminalListeners) listener(message);
            }
            break;
          case "workspace.snapshot":
            if (this.#state.status !== "ready") break;
            if (
              this.#workspace?.epoch === message.snapshot.epoch &&
              this.#workspace.revision > message.snapshot.revision
            )
              break;
            this.#workspace = message.snapshot;
            if (this.#resync) this.#finishResync(this.#resync);
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
            createProtocolError(
              "INTERNAL_ERROR",
              `Could not reach daemon at ${this.endpoint.url}`,
              { websocketUpgradeFailed: true },
            ),
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
            { closeCode: event.code, websocketUpgradeFailed: this.#state.status === "connecting" },
          );
          if (wasCurrent) this.#setState({ status: "error", error });
          settleReject(error);
          return;
        }

        if (wasCurrent && this.#state.status === "ready") {
          this.#setState({
            status: "disconnected",
            reason: event.reason || `closed (${event.code})`,
            closeCode: event.code,
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

  #subscribeWorkspace(): void {
    this.#resync = { agents: new Set(), terminals: new Set() };
    this.#socket?.send(JSON.stringify({ type: "workspace.subscribe" }));
  }

  /** Drops what the daemon no longer reports and publishes the settled lists at once. */
  #finishResync(resync: { agents: Set<string>; terminals: Set<string> }): void {
    this.#resync = null;
    this.#terminals = this.#terminals.filter((session) => resync.terminals.has(session.id));
    for (const listener of this.#terminalSessionListeners) listener();
    this.#agents = this.#agents.filter((agent) => resync.agents.has(agent.id));
    const list: AgentEvent = { type: "agent.list", agents: this.#agents };
    for (const listener of this.#agentListeners) listener(list);
  }

  /** Without a workspace subscription nothing will refresh these, so they cannot be kept. */
  #forgetSessions(): void {
    this.#terminals = [];
    for (const listener of this.#terminalSessionListeners) listener();
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
      this.#resync = null;
      this.#authRefresh?.(false);
      this.#hostUsage = null;
      for (const listener of this.#hostUsageListeners) listener(null);
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
      for (const pending of this.#fileRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(
            "Connection lost. Your draft is kept; reload from disk before retrying a save.",
          ),
        );
      }
      this.#fileRequests.clear();
      for (const pending of this.#providerRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Connection lost. Reload provider settings before retrying."));
      }
      this.#providerRequests.clear();
      for (const pending of this.#themeRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Connection lost. Reload theme settings before retrying."));
      }
      this.#themeRequests.clear();
      for (const pending of this.#scheduleRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Machine disconnected. Check schedules before retrying."));
      }
      this.#scheduleRequests.clear();
      this.#schedules = null;
      for (const listener of this.#scheduleListeners) listener(null);
      for (const pending of this.#resourceRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(
            "Connection lost. Refresh resources before retrying; the operation may have completed.",
          ),
        );
      }
      this.#resourceRequests.clear();
      for (const pending of this.#pullRequestRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(
            "Connection lost. Pull requests refresh after reconnecting; a merge or close may have completed.",
          ),
        );
      }
      this.#pullRequestRequests.clear();
      for (const pending of this.#dictationRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Machine disconnected. Dictation stopped."));
      }
      this.#dictationRequests.clear();
      this.#dictationModel = null;
    }
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
}

function defaultWebSocketFactory(url: string, protocols?: string | string[]): WebSocketLike {
  if (typeof WebSocket === "undefined") {
    throw new Error("No global WebSocket implementation available; pass `webSocketFactory`.");
  }
  return new WebSocket(url, protocols);
}
