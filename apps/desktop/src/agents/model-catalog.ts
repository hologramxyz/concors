import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentInfo, AgentProviderCatalog } from "@concors/protocol";

const FRESH_MS = 5 * 60_000;
const caches = new WeakMap<DaemonConnection, Map<string, ModelCatalog>>();
interface Snapshot {
  providers: AgentProviderCatalog[];
  pending: readonly string[];
  error: string | null;
}

/** Shared by composers on one connection/project; credentials and other machines never share it. */
export class ModelCatalog {
  private snapshot: Snapshot = { providers: [], pending: [], error: null };
  private listeners = new Set<() => void>();
  private requests = new Map<string, Promise<void>>();
  private fetched = new Map<string, number>();
  private version = 0;
  readonly connection: DaemonConnection;
  constructor(connection: DaemonConnection) {
    this.connection = connection;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
  invalidate() {
    this.version++;
    this.fetched.clear();
    this.requests.clear();
    this.publish({ providers: [], pending: [], error: null });
  }
  load(agent: AgentInfo, provider?: string, force = false): Promise<void> {
    const connection = this.connection;
    if (
      connection.state.status !== "ready" ||
      !agent.threadId ||
      !connection.state.daemon.capabilities?.includes("agent-providers")
    )
      return Promise.resolve();
    const key = provider ?? "";
    const pending = this.requests.get(key);
    if (pending) return pending;
    if (!force && Date.now() - (this.fetched.get(key) ?? 0) < FRESH_MS) return Promise.resolve();
    const version = this.version;
    this.publish({ pending: [...this.snapshot.pending, key], error: null });
    const request = (async () => {
      try {
        const result = await connection.requestAgent(
          { kind: "provider-catalog", sessionId: agent.id, ...(provider ? { provider } : {}) },
          crypto.randomUUID(),
        );
        if (version !== this.version) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        const previous = this.snapshot.providers;
        const providers = (result.outcome.providers ?? []).map((next) => {
          const old = previous.find((item) => item.id === next.id);
          // Keep usable models visible during refreshes and transient discovery failures.
          return (!next.loaded || next.error) && old?.models.length
            ? { ...old, ...(next.error ? { error: next.error } : {}) }
            : next;
        });
        this.fetched.set(key, Date.now());
        for (const entry of providers)
          if (
            entry.loaded &&
            !entry.error &&
            (entry.id === provider || entry.id === agent.provider)
          )
            this.fetched.set(entry.id, Date.now());
        // Failed cold loads can be retried by reopening; do not cache a failure for five minutes.
        if (provider && providers.find((item) => item.id === provider)?.error)
          this.fetched.delete(key);
        this.publish({ providers });
      } catch (cause) {
        if (version === this.version)
          this.publish({
            error: cause instanceof Error ? cause.message : "Could not refresh models",
          });
      } finally {
        if (version === this.version) {
          this.requests.delete(key);
          this.publish({ pending: this.snapshot.pending.filter((item) => item !== key) });
        }
      }
    })();
    this.requests.set(key, request);
    return request;
  }
  async warm(agent: AgentInfo) {
    await this.load(agent);
    // Warm installed providers in the background, with at most two discovery processes at once.
    const queue = this.snapshot.providers.filter((p) => p.id !== agent.provider).map((p) => p.id);
    const version = this.version;
    await Promise.all(
      [0, 1].map(async () => {
        while (
          queue.length &&
          version === this.version &&
          this.connection.state.status === "ready"
        ) {
          const provider = queue.shift();
          if (provider) await this.load(agent, provider);
        }
      }),
    );
  }
}
export function modelCatalog(
  connection: DaemonConnection,
  directory: string,
  epoch = connection.workspace?.epoch,
) {
  let projects = caches.get(connection);
  if (!projects) {
    projects = new Map();
    caches.set(connection, projects);
  }
  const key = JSON.stringify([epoch, directory]);
  let catalog = projects.get(key);
  if (!catalog) {
    catalog = new ModelCatalog(connection);
    projects.set(key, catalog);
  }
  return catalog;
}
export function invalidateModelCatalogs(connection: DaemonConnection) {
  for (const catalog of caches.get(connection)?.values() ?? []) catalog.invalidate();
}
