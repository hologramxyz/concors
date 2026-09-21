import type { DaemonConnection } from "@concors/daemon-client";
import {
  AGENT_USAGE_CAPABILITY,
  AGENT_USAGE_TTL_MS,
  type AgentPlanUsage,
  unsupportedPlanUsage,
} from "@concors/protocol";

/**
 * What is left of each provider's plan, asked for only while someone is looking at it.
 *
 * Plan windows belong to an account, so sessions of one provider share an answer: opening the
 * meter on a second Claude chat reuses the first. An account's answer is reused for as long as
 * the machine caches it, and a failure is shown rather than retried in a loop.
 */
export interface PlanUsageState {
  readonly usage: AgentPlanUsage | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** On this client's clock, so a machine whose clock is off cannot make answers look fresh. */
  readonly receivedAt: number | null;
}

const idle: PlanUsageState = { usage: null, loading: false, error: null, receivedAt: null };

export class PlanUsageStore {
  #connection: Pick<DaemonConnection, "state" | "requestAgent">;
  #states = new Map<string, PlanUsageState>();
  #pending = new Map<string, Promise<void>>();
  #listeners = new Set<() => void>();
  #snapshot: ReadonlyMap<string, PlanUsageState> = new Map();
  constructor(connection: Pick<DaemonConnection, "state" | "requestAgent">) {
    this.#connection = connection;
  }
  getSnapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  get supported() {
    const { state } = this.#connection;
    return (
      state.status === "ready" && !!state.daemon.capabilities?.includes(AGENT_USAGE_CAPABILITY)
    );
  }
  #publish(provider: string, next: PlanUsageState) {
    this.#states.set(provider, next);
    this.#snapshot = new Map(this.#states);
    for (const listener of this.#listeners) listener();
  }

  /**
   * `provider` is the provider configuration (configurations can sign in to different accounts);
   * `sessionId` is who to ask through. Only an account's answer is reused: "open this agent" or
   * "still starting" describes one session, so the next look asks again.
   */
  refresh(provider: string, sessionId: string, force = false) {
    if (!this.supported || this.#pending.has(provider)) return;
    const current = this.#states.get(provider);
    const fresh =
      current?.usage?.status === "available" &&
      current.receivedAt !== null &&
      Date.now() - current.receivedAt < AGENT_USAGE_TTL_MS;
    if (!force && fresh) return;
    this.#publish(provider, { ...(current ?? idle), loading: true, error: null });
    const request = this.#connection
      .requestAgent({ kind: "usage", sessionId }, crypto.randomUUID())
      .then(({ outcome }) => {
        if (outcome.status === "ok")
          this.#publish(provider, {
            usage:
              outcome.usage ??
              unsupportedPlanUsage(provider, "This machine did not report plan usage."),
            loading: false,
            error: null,
            receivedAt: Date.now(),
          });
        else
          this.#publish(provider, {
            ...(this.#states.get(provider) ?? idle),
            loading: false,
            error: outcome.message,
          });
      })
      .catch((cause: unknown) =>
        this.#publish(provider, {
          ...(this.#states.get(provider) ?? idle),
          loading: false,
          error: cause instanceof Error ? cause.message : "Could not read plan usage.",
        }),
      )
      .finally(() => this.#pending.delete(provider));
    this.#pending.set(provider, request);
  }
}

const stores = new WeakMap<DaemonConnection, PlanUsageStore>();
export function planUsageStore(connection: DaemonConnection) {
  let store = stores.get(connection);
  if (!store) {
    store = new PlanUsageStore(connection);
    stores.set(connection, store);
  }
  return store;
}
export const noPlanUsage = idle;
