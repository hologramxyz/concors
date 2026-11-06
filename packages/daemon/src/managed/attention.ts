import { randomUUID } from "node:crypto";
import { AgentInfoSchema, PROTOCOL_VERSION, type AgentInfo } from "@concors/protocol";
import { WebSocket, type RawData } from "ws";
import type { HostDescriptor } from "../hosting/session-host.ts";
import { DAEMON_VERSION } from "../version.ts";
import type { Logger } from "./log.ts";

/*
 * Tells the control plane when a chat on this machine wants a look: its turn finished, it waits
 * for an answer, or it stopped with an error. The control plane turns that into a push
 * notification on the phones of whoever sent the chat's latest prompt (see
 * concors-server docs/push-notifications.md). Only identifiers leave the machine.
 *
 * It runs in the gateway, beside the heartbeat and its machine credential, and follows the
 * session host's chats over the same private protocol the apps use. The host stays the only
 * owner of sessions and knows nothing of the control plane.
 */

export type AttentionKind = "done" | "needs_input" | "failed";

/** What a status change means for a notification, or null when it means nothing. */
export function attentionKind(
  previous: AgentInfo["status"] | undefined,
  next: AgentInfo["status"],
): AttentionKind | null {
  if (previous !== "starting" && previous !== "working") return null;
  if (next === "done" || next === "needs_input" || next === "failed") return next;
  return null;
}

/**
 * Who sent each chat's latest prompt, from what devices sent through the gateway. A chat whose
 * prompt came from a schedule, or that no device has written to since the gateway started, has
 * none; the control plane then notifies the machine's creator.
 */
export class PromptSenders {
  readonly #senders = new Map<string, string>();
  readonly #limit: number;
  constructor(limit = 1000) {
    this.#limit = limit;
  }
  /** Reads a device's message only if it starts like a prompt, so other traffic stays cheap. */
  note(data: RawData, userId: string): void {
    const message = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data);
    if (message.length > 512 * 1024) return;
    if (!/^\s*\{\s*"type"\s*:\s*"agent\.request"/.test(message.subarray(0, 64).toString("utf8")))
      return;
    try {
      const parsed = JSON.parse(message.toString("utf8")) as {
        operation?: { kind?: unknown; sessionId?: unknown };
      };
      const { kind, sessionId } = parsed.operation ?? {};
      if (
        (kind === "send" || kind === "steer" || kind === "queue-add") &&
        typeof sessionId === "string"
      )
        this.set(sessionId, userId);
    } catch {
      // Not ours to judge: the host answers malformed requests itself.
    }
  }
  set(sessionId: string, userId: string): void {
    this.#senders.delete(sessionId);
    this.#senders.set(sessionId, userId);
    if (this.#senders.size > this.#limit) {
      const oldest = this.#senders.keys().next().value;
      if (oldest !== undefined) this.#senders.delete(oldest);
    }
  }
  get(sessionId: string): string | undefined {
    return this.#senders.get(sessionId);
  }
}

export interface AttentionReporterOptions {
  controlPlaneUrl: string;
  machineId: string;
  agentToken: string;
  host: () => Promise<HostDescriptor>;
  senders: PromptSenders;
  logger: Logger;
  fetchImpl?: typeof fetch;
  /** Waits between reconnecting to the host and between retries of a report (tests shorten). */
  retryMs?: number;
}

const ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

export function createAttentionReporter(options: AttentionReporterOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryMs = options.retryMs ?? 5_000;
  const url = `${options.controlPlaneUrl}/api/v1/agent/attention`;
  const statuses = new Map<string, AgentInfo["status"]>();
  let socket: WebSocket | null = null;
  let stopped = true;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  const reports = new Set<Promise<void>>();

  async function report(agent: AgentInfo, kind: AttentionKind) {
    const userId = options.senders.get(agent.id);
    const body = JSON.stringify({
      eventId: randomUUID(),
      kind,
      projectId: agent.projectId,
      sessionId: agent.id,
      ...(userId ? { userId } : {}),
    });
    for (let attempt = 1; attempt <= ATTEMPTS && !stopped; attempt++) {
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.machineId}.${options.agentToken}`,
            "content-type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        // An older control plane has no such endpoint, and a refused report is not retried.
        if (response.ok || (response.status >= 400 && response.status < 500)) return;
      } catch {
        // Network trouble: try again shortly, with the same event ID so it is sent once.
      }
      if (attempt < ATTEMPTS)
        await new Promise((resolve) => setTimeout(resolve, retryMs * attempt).unref());
    }
    options.logger.warn({ kind }, "agent attention could not be reported");
  }

  function observe(agent: AgentInfo) {
    const previous = statuses.get(agent.id);
    statuses.set(agent.id, agent.status);
    const kind = attentionKind(previous, agent.status);
    if (!kind) return;
    const job = report(agent, kind).finally(() => reports.delete(job));
    reports.add(job);
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(reconnect);
    reconnect = setTimeout(() => void connect(), retryMs);
    reconnect.unref();
  }

  async function connect() {
    if (stopped) return;
    let host: HostDescriptor;
    try {
      host = await options.host();
    } catch {
      schedule();
      return;
    }
    if (stopped) return;
    const next = new WebSocket(`ws://127.0.0.1:${host.port}/ws`, {
      headers: { authorization: `Bearer ${host.token}` },
      handshakeTimeout: 5000,
    });
    socket = next;
    // Statuses seen before a reconnect may be stale; the snapshot that follows starts afresh,
    // so a turn that ended while disconnected is not reported late.
    let fresh = true;
    next.on("open", () =>
      next.send(
        JSON.stringify({
          type: "client.hello",
          capabilities: ["agent-providers-v2"],
          protocolVersion: PROTOCOL_VERSION,
          client: { kind: "cli", name: "concors-attention", version: DAEMON_VERSION },
        }),
      ),
    );
    next.on("message", (data: RawData) => {
      const text = data.toString();
      if (text.includes('"daemon.ready"') && /^\s*\{\s*"type"\s*:\s*"daemon\.ready"/.test(text)) {
        next.send(JSON.stringify({ type: "workspace.subscribe" }));
        return;
      }
      // Streamed replies arrive as agent.item; only state changes are read.
      if (!/^\s*\{\s*"type"\s*:\s*"agent\.state"/.test(text.slice(0, 64))) {
        if (fresh && /^\s*\{\s*"type"\s*:\s*"workspace\.snapshot"/.test(text.slice(0, 64)))
          fresh = false;
        return;
      }
      try {
        const agent = AgentInfoSchema.parse((JSON.parse(text) as { agent: unknown }).agent);
        if (fresh) statuses.set(agent.id, agent.status);
        else observe(agent);
      } catch {
        // A message this version cannot read is skipped, not fatal.
      }
    });
    next.on("error", () => next.terminate());
    next.on("close", () => {
      if (socket === next) socket = null;
      schedule();
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void connect();
    },
    async stop() {
      stopped = true;
      clearTimeout(reconnect);
      socket?.terminate();
      socket = null;
      await Promise.allSettled(reports);
    },
  };
}
