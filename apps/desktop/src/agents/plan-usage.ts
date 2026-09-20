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
 * meter on a second Claude chat reuses the first. Answers are reused for as long as the machine
 * caches them, and a failure is shown rather than retried in a loop.
 */
export interface PlanUsageState {
  readonly usage: AgentPlanUsage | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const idle: PlanUsageState = { usage: null, loading: false, error: null };

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

  /** `provider` groups sessions that share an account; `sessionId` is who to ask through. */
  refresh(provider: string, sessionId: string, force = false) {
    if (!this.supported || this.#pending.has(provider)) return;
    const current = this.#states.get(provider);
    if (!force && current?.usage && Date.now() - current.usage.fetchedAt < AGENT_USAGE_TTL_MS)
      return;
    this.#publish(provider, { ...(current ?? idle), loading: true, error: null });
    const request = this.#connection
      .requestAgent({ kind: "usage", sessionId }, crypto.randomUUID())
      .then(({ outcome }) => {
        if (outcome.status === "ok" && outcome.usage)
          this.#publish(provider, { usage: outcome.usage, loading: false, error: null });
        else if (outcome.status === "ok")
          this.#publish(provider, {
            usage: unsupportedPlanUsage(provider, "This machine did not report plan usage."),
            loading: false,
            error: null,
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
