import { ScheduleManager } from "../schedules/manager.ts";
import { ScheduleStore } from "../schedules/store.ts";
import { ScheduleTools } from "../schedules/tools.ts";
import { DICTATION_CAPABILITY, SCHEDULES_CAPABILITY } from "@concors/protocol";
import { DictationService } from "../dictation/service.ts";
import { ThemeRegistry } from "../themes/registry.ts";
import { dirname, join, basename } from "node:path";
import { ProviderRegistry } from "../agents/providers/registry.ts";
import { providerFactory } from "../agents/providers/index.ts";
import type { AccountBackendFactory } from "../agents/accounts/manager.ts";
import { ProjectFiles } from "../files/service.ts";
import { AgentManager, type AgentProviderFactory } from "../agents/manager.ts";
import { ProjectManager } from "../projects/manager.ts";
import { WorkspacePullRequests, type GitHubSource } from "../projects/pull-requests.ts";
import { GitHubCredentials } from "../github/credentials.ts";
import { randomUUID } from "node:crypto";
import { TerminalManager } from "../terminal/manager.ts";
import {
  PROTOCOL_VERSIONS,
  WS_PATH,
  createProtocolError,
  parseClientMessage,
  type ClientMessage,
  type TerminalEvent,
  type DaemonMessage,
  type ProtocolError,
} from "@concors/protocol";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

import type { WorkspaceStore } from "../workspace/store.ts";

import type { DaemonState } from "../state.ts";
import { createHostUsageMonitor } from "../host/usage.ts";
import { MachineResources } from "../host/resources.ts";

export interface ProtocolEndpointOptions {
  readonly agentProviderFactory?: AgentProviderFactory;
  readonly accountBackendFactory?: AccountBackendFactory;
  readonly gitHub?: GitHubSource;
  readonly speechModelsDirectory?: string;
  readonly state: DaemonState;
  readonly workspace: WorkspaceStore;
  /** How long a freshly-opened socket may stay silent before we drop it. */
  readonly handshakeTimeoutMs?: number;
}

/** WebSocket close codes used by the daemon. 1002 = protocol error, 1001 = going away. */
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_GOING_AWAY = 1001;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;

/**
 * Mounts the Concors protocol WebSocket endpoint.
 *
 * Every connection goes through the handshake defined in `@concors/protocol`:
 *
 *   client.hello  →  validate  →  daemon.ready | error (+ close)
 *
 * Workspace subscriptions receive ordered authoritative snapshots. Returns a function that
 * closes every open connection during graceful shutdown.
 */
export function registerProtocolEndpoint(
  app: FastifyInstance,
  options: ProtocolEndpointOptions,
): () => Promise<void> {
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const connections = new Set<WebSocket>();
  const subscribers = new Set<WebSocket>();
  const agentV2 = new WeakSet<WebSocket>();
  const scheduleClients = new WeakSet<WebSocket>();
  const dictationClients = new Set<WebSocket>();
  const hostUsage = createHostUsageMonitor();
  const send = (socket: WebSocket, message: DaemonMessage): void => {
    if (socket.readyState !== socket.OPEN) return;
    if (!agentV2.has(socket) && (message.type === "agent.state" || message.type === "agent.item")) {
      socket.send(
        JSON.stringify({
          type: "error",
          error: createProtocolError(
            "PROTOCOL_VERSION_UNSUPPORTED",
            "Update Concors on this device to use unified agent chat with this daemon.",
          ),
        }),
      );
      socket.close(CLOSE_PROTOCOL_ERROR, "Agent client upgrade required");
      return;
    }
    if (socket.bufferedAmount > 2 * 1024 * 1024) {
      socket.close(1013, "Client must reconnect to catch up");
      return;
    }
    socket.send(JSON.stringify(message));
  };

  const dictation = options.speechModelsDirectory
    ? new DictationService(options.speechModelsDirectory)
    : undefined;
  dictation?.onModel((model) => {
    for (const target of dictationClients) send(target, { type: "dictation.model", model });
  });
  const files = new ProjectFiles(options.workspace);
  const resources = new MachineResources(options.workspace);
  const pullRequests = options.gitHub
    ? new WorkspacePullRequests(
        options.workspace,
        new GitHubCredentials(options.gitHub.token),
        options.gitHub.fetch,
        options.gitHub.pullRequest,
      )
    : new WorkspacePullRequests(options.workspace);
  const projects = new ProjectManager(options.workspace, () => {
    for (const target of subscribers) {
      send(target, { type: "workspace.snapshot", snapshot: options.workspace.snapshot() });
      send(target, { type: "project.setups", setups: options.workspace.projectSetups() });
    }
  });
  const attachments = options.workspace.attachmentsDirectory;
  const providers = new ProviderRegistry(
    basename(attachments) === "attachments"
      ? join(dirname(attachments), "providers")
      : attachments + "-providers",
  );
  const themes = new ThemeRegistry(
    basename(attachments) === "attachments"
      ? join(dirname(attachments), "themes")
      : attachments + "-themes",
  );
  const terminals = new TerminalManager(
    options.workspace,
    () => {
      const snapshot = options.workspace.snapshot();
      for (const target of subscribers) send(target, { type: "workspace.snapshot", snapshot });
    },
    (session) => {
      for (const target of subscribers) send(target, { type: "terminal.state", session });
    },
    () => providers.terminalEnvironment(),
  );
  const scheduleTools = new ScheduleTools();
  const agents = new AgentManager(
    options.workspace,
    (event) => {
      if (event.type === "agent.state") schedules?.observe(event.agent);
      for (const target of subscribers) send(target, event);
    },
    () => {
      for (const target of subscribers)
        send(target, { type: "workspace.snapshot", snapshot: options.workspace.snapshot() });
    },
    options.agentProviderFactory ?? providerFactory(providers),
    providers,
    options.accountBackendFactory,
    (info) => scheduleTools.context(info),
  );
  const schedules = new ScheduleManager(
    new ScheduleStore(
      basename(attachments) === "attachments"
        ? join(dirname(attachments), "schedules.sqlite")
        : ":memory:",
    ),
    options.workspace,
    agents,
    providers,
    (list) => {
      for (const target of subscribers)
        if (scheduleClients.has(target)) send(target, { type: "schedule.list", schedules: list });
    },
  );
  app.addHook("onReady", async () => {
    // Injected providers (tests) never run the real CLIs, so there are no versions to check.
    if (!options.agentProviderFactory) providers.startVersionChecks();
    dictation?.start();
    await scheduleTools.start(schedules);
    schedules.start();
  });
  app.addHook("onClose", async () => {
    const closingSchedules = schedules.close();
    await scheduleTools.close();
    providers.close();
    hostUsage.close();
    dictation?.close();
    await agents.close();
    await closingSchedules;
    projects.close();
    terminals.close();
  });

  app.get(WS_PATH, { websocket: true }, (socket, request) => {
    const origin = request.headers.origin;
    // Native/CLI clients do not send Origin. Browser clients must use a known local UI.
    if (
      origin &&
      ![
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
      ].includes(origin)
    ) {
      socket.close(1008, "Origin is not allowed");
      return;
    }
    const log = request.log.child({ connection: request.id });
    connections.add(socket);
    let unsubscribeUsage: (() => void) | undefined;
    const viewer = {
      id: randomUUID(),
      send: (event: TerminalEvent) => send(socket, event),
      active: () => socket.readyState === socket.OPEN,
    };
    socket.on("close", () => {
      unsubscribeUsage?.();
      connections.delete(socket);
      subscribers.delete(socket);
      dictationClients.delete(socket);
      dictation?.detach(viewer.id);
      terminals.detach(viewer.id);
      void agents.accounts.detach(viewer.id);
    });

    new ConnectionHandler(socket, log, options.state, handshakeTimeoutMs, (message) => {
      if (message.type === "client.hello") {
        if (message.capabilities?.includes("agent-providers-v2")) agentV2.add(socket);
        if (message.capabilities?.includes(SCHEDULES_CAPABILITY)) scheduleClients.add(socket);
        if (dictation && message.capabilities?.includes(DICTATION_CAPABILITY))
          dictationClients.add(socket);
        return;
      }
      if (message.type === "dictation.request" || message.type === "dictation.audio") {
        if (!dictation || !dictationClients.has(socket)) {
          if (message.type === "dictation.request")
            send(socket, {
              type: "error",
              error: createProtocolError("INVALID_MESSAGE", "Dictation is not available"),
            });
          return;
        }
        if (message.type === "dictation.audio") dictation.audio(viewer.id, message);
        else
          send(
            socket,
            dictation.request(viewer.id, message, (event) => send(socket, event)),
          );
        return;
      }
      if (message.type === "agent.request" && !agentV2.has(socket)) {
        send(socket, {
          type: "agent.result",
          requestId: message.requestId,
          outcome: {
            status: "error",
            message: "Update Concors on this device to use unified agent chat with this daemon.",
          },
        });
        return;
      }
      if (message.type === "host.subscribe") {
        if (message.enabled) {
          unsubscribeUsage ??= hostUsage.subscribe((usage) =>
            send(socket, { type: "host.usage", usage }),
          );
        } else {
          unsubscribeUsage?.();
          unsubscribeUsage = undefined;
        }
        return;
      }
      if (
        message.type === "terminal.request" ||
        message.type === "terminal.input" ||
        message.type === "project.request" ||
        message.type === "agent.request" ||
        message.type === "file.request" ||
        message.type === "provider.request" ||
        message.type === "theme.request" ||
        message.type === "schedule.request" ||
        message.type === "resource.request" ||
        message.type === "pull-request.request"
      ) {
        if (!subscribers.has(socket)) {
          send(socket, {
            type: "error",
            error: createProtocolError("INVALID_MESSAGE", "Subscribe to the workspace first"),
          });
          return;
        }
        if (message.type === "schedule.request") send(socket, schedules.request(message));
        else if (message.type === "resource.request")
          void resources.request(message).then((result) => send(socket, result));
        else if (message.type === "pull-request.request")
          void pullRequests.request(message).then((result) => send(socket, result));
        else if (message.type === "theme.request")
          send(socket, {
            type: "theme.result",
            requestId: message.requestId,
            catalog: themes.catalog(),
          });
        else if (message.type === "provider.request") {
          if (message.operation.kind === "sessions-list")
            void agents.discoverSessions(message).then((result) => send(socket, result));
          else if (message.operation.kind === "account")
            void agents.providerAccount(viewer.id, message).then((result) => send(socket, result));
          else if (message.operation.kind === "usage")
            void agents.providerUsage(message).then((result) => send(socket, result));
          else if (message.operation.kind === "activate")
            send(socket, agents.activateSubscription(message));
          else send(socket, providers.request(message));
        } else if (message.type === "file.request")
          void files.request(message).then((result) => send(socket, result));
        else if (message.type === "agent.request")
          void agents.request(message, viewer.id).then((result) => send(socket, result));
        else if (message.type === "project.request") {
          if (message.operation.kind === "browse")
            void projects.browse(message).then((result) => send(socket, result));
          else send(socket, projects.request(message));
        } else if (message.type === "terminal.input")
          terminals.input(viewer, message.sessionId, message.data);
        else void terminals.request(viewer, message).then((result) => send(socket, result));
      } else if (message.type === "workspace.subscribe") {
        subscribers.add(socket);
        if (scheduleClients.has(socket))
          send(socket, { type: "schedule.list", schedules: schedules.list() });
        for (const session of options.workspace.terminals())
          send(socket, { type: "terminal.state", session });
        send(socket, { type: "agent.list", agents: [] });
        for (const agent of options.workspace.agents())
          send(socket, { type: "agent.state", agent });
        send(socket, { type: "project.setups", setups: options.workspace.projectSetups() });
        send(socket, { type: "workspace.snapshot", snapshot: options.workspace.snapshot() });
      } else if (message.type === "workspace.command") {
        if (!subscribers.has(socket)) {
          send(socket, {
            type: "error",
            error: createProtocolError(
              "INVALID_MESSAGE",
              "Subscribe to the workspace before editing",
            ),
          });
          return;
        }
        try {
          const { result, snapshot, changed } = options.workspace.execute(message);
          // State is delivered before settlement, including fresh state after a conflict/retry.
          if (changed)
            for (const target of subscribers)
              send(target, { type: "workspace.snapshot", snapshot });
          else send(socket, { type: "workspace.snapshot", snapshot });
          send(socket, result);
          // Renaming or closing a chat's pane: keep its names, stop a CLI left with nothing to show.
          if (changed) agents.workspaceEdited();
        } catch (error) {
          log.error({ err: error }, "workspace command failed");
          send(socket, {
            type: "workspace.result",
            commandId: message.commandId,
            outcome: {
              status: "rejected",
              code: "INTERNAL_ERROR",
              message: "Could not save workspace",
            },
          });
        }
      }
    }).run();
  });

  return async () => {
    providers.close();
    hostUsage.close();
    dictation?.close();
    await agents.close();
    projects.close();
    terminals.close();
    for (const socket of connections) {
      socket.close(CLOSE_GOING_AWAY, "daemon shutting down");
    }
    connections.clear();
  };
}

class ConnectionHandler {
  #handshakeComplete = false;
  private readonly socket: WebSocket;
  private readonly log: FastifyBaseLogger;
  private readonly state: DaemonState;
  private readonly handshakeTimeoutMs: number;
  private readonly workspaceMessage: (message: ClientMessage) => void;

  constructor(
    socket: WebSocket,
    log: FastifyBaseLogger,
    state: DaemonState,
    handshakeTimeoutMs: number,
    workspaceMessage: (message: ClientMessage) => void,
  ) {
    this.socket = socket;
    this.log = log;
    this.state = state;
    this.handshakeTimeoutMs = handshakeTimeoutMs;
    this.workspaceMessage = workspaceMessage;
  }

  run(): void {
    const handshakeTimer = setTimeout(() => {
      if (!this.#handshakeComplete) {
        this.fail(
          createProtocolError(
            "HANDSHAKE_TIMEOUT",
            `No client.hello received within ${this.handshakeTimeoutMs}ms`,
          ),
        );
      }
    }, this.handshakeTimeoutMs);

    this.socket.on("message", (data) => {
      const decoded = decodeJson(data.toString());

      // Checked before schema validation so a newer/older client gets a precise error rather
      // than a generic validation failure.
      const unsupported = unsupportedProtocolVersion(decoded);
      if (unsupported !== null) {
        this.fail(
          createProtocolError(
            "PROTOCOL_VERSION_UNSUPPORTED",
            `Protocol version "${unsupported}" is not supported by this daemon`,
            { supported: PROTOCOL_VERSIONS },
          ),
        );
        return;
      }

      const parsed = parseClientMessage(decoded);
      if (!parsed.success) {
        const error = createProtocolError("INVALID_MESSAGE", "Message failed validation", {
          issues: parsed.error.issues,
        });
        if (this.#handshakeComplete) {
          this.send({ type: "error", error });
        } else {
          this.fail(error);
        }
        return;
      }
      this.handle(parsed.data);
    });

    this.socket.on("close", () => clearTimeout(handshakeTimer));
    this.socket.on("error", (err) => this.log.warn({ err }, "websocket error"));
  }

  private handle(message: ClientMessage): void {
    if (message.type !== "client.hello") {
      if (!this.#handshakeComplete)
        this.fail(createProtocolError("HANDSHAKE_REQUIRED", "Send client.hello first"));
      else this.workspaceMessage(message);
      return;
    }
    switch (message.type) {
      case "client.hello": {
        if (this.#handshakeComplete) {
          this.send({
            type: "error",
            error: createProtocolError("INVALID_MESSAGE", "Handshake already completed"),
          });
          return;
        }
        this.#handshakeComplete = true;
        this.log.info(
          { client: message.client, protocolVersion: message.protocolVersion },
          "client connected",
        );
        this.send({ type: "daemon.ready", ...this.state.info() });
        this.workspaceMessage(message);
        return;
      }
    }
  }

  private send(message: DaemonMessage): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  /** Sends a structured error and closes the socket. Used for unrecoverable handshake failures. */
  private fail(error: ProtocolError): void {
    this.log.warn({ code: error.code }, error.message);
    this.send({ type: "error", error });
    this.socket.close(CLOSE_PROTOCOL_ERROR, error.code);
  }
}

function decodeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // fails schema validation downstream with a clear issue
  }
}

/** Returns the requested protocol version if it is one this daemon does not speak, else `null`. */
function unsupportedProtocolVersion(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const { type, protocolVersion } = value as Record<string, unknown>;
  if (type !== "client.hello" || typeof protocolVersion !== "string") return null;
  return (PROTOCOL_VERSIONS as readonly string[]).includes(protocolVersion)
    ? null
    : protocolVersion;
}
