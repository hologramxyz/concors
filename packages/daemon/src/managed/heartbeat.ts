import type { MachineResources } from "./resources.ts";
import type { Logger } from "./log.ts";

/*
 * Tells the control plane the agent is alive: version, uptime and how many
 * sessions run. The control plane shows it on the machine and will later use
 * this channel to push updates and session summaries.
 */

export const HEARTBEAT_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface HeartbeatOptions {
  controlPlaneUrl: string;
  machineId: string;
  agentToken: string;
  version: string;
  countSessions: () => Promise<number>;
  collectResources?: () => Promise<MachineResources>;
  logger: Logger;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
}

export interface HeartbeatBody {
  version: string;
  uptimeSeconds: number;
  sessions: number;
  resources?: MachineResources | null;
}

export function createHeartbeat(options: HeartbeatOptions): {
  start(): void;
  stop(): void;
  beat(): Promise<void>;
} {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${options.controlPlaneUrl}/api/v1/agent/heartbeat`;
  let timer: NodeJS.Timeout | null = null;
  let failures = 0;
  let generation = 0;
  let pending: Promise<void> | null = null;
  let controller: AbortController | undefined;

  async function send(): Promise<void> {
    const started = generation;
    const resources = options.collectResources
      ? await options.collectResources().catch(() => null)
      : undefined;
    const body: HeartbeatBody = {
      version: options.version,
      uptimeSeconds: Math.round(process.uptime()),
      sessions: await options.countSessions().catch(() => 0),
      ...(resources !== undefined ? { resources } : {}),
    };
    if (started !== generation) return;
    controller = new AbortController();
    let status: number | undefined;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.machineId}.${options.agentToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      status = response.status;
      // Consume the small response so repeated heartbeats can reuse their connection.
      await response.arrayBuffer();
      if (!response.ok) throw new Error("Control plane rejected heartbeat");
      if (failures > 0) options.logger.info({ failures }, "heartbeat back");
      failures = 0;
    } catch {
      if (started !== generation) return;
      failures += 1;
      // Log the first miss and then every tenth: outages are long and logs are not.
      if (failures === 1 || failures % 10 === 0) {
        // Fetch errors may contain request credentials; log only the status and failure count.
        options.logger.warn({ status, failures }, "heartbeat failed");
      }
    } finally {
      controller = undefined;
    }
  }

  function beat(): Promise<void> {
    return (pending ??= send().finally(() => {
      pending = null;
    }));
  }

  return {
    beat,
    start() {
      if (timer) return;
      void beat();
      timer = setInterval(() => void beat(), options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      generation++;
      controller?.abort();
    },
  };
}
