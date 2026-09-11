import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentInfo, AgentProviderCatalog } from "@concors/protocol";
import { ProviderCatalogCache } from "./provider-catalog-cache";

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
  private rows = new ProviderCatalogCache();
  readonly connection: DaemonConnection;
  constructor(connection: DaemonConnection) {
    this.connection = connection;
    this.rows.subscribe(() => this.publish({ providers: this.rows.getSnapshot() }));
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
    this.rows.clear();
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
    const key = provider ?? agent.provider;
    const pending = this.requests.get(key);
    if (pending) return pending;
    const fetched = this.fetched.get(key);
    if (!force && fetched !== undefined && Date.now() - fetched < FRESH_MS)
      return Promise.resolve();
    const version = this.version;
    this.publish({ pending: [...this.snapshot.pending, key], error: null });
    const request = (async () => {
      try {
        const revision = this.rows.getSnapshot()[0]?.revision;
        await this.rows.load(key, async () => {
          const result = await connection.requestAgent(
            { kind: "provider-catalog", sessionId: agent.id, provider: key },
            crypto.randomUUID(),
          );
          if (result.outcome.status === "error") throw new Error(result.outcome.message);
          return result.outcome.providers ?? [];
        });
        if (version !== this.version) return;
        const providers = this.rows.getSnapshot();
        if (revision !== providers[0]?.revision) this.fetched.clear();
        const selected = providers.find((item) => item.id === key);
        if (selected?.loaded && !selected.error) this.fetched.set(key, Date.now());
        // Failed cold loads can be retried by reopening; do not cache a failure for five minutes.
        else this.fetched.delete(key);
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
    const entries = projects;
    connection.subscribe((state) => {
      if (state.status !== "ready") for (const catalog of entries.values()) catalog.invalidate();
    });
  }
  const key = JSON.stringify([epoch, directory]);
  let catalog = projects.get(key);
  if (!catalog) {
    catalog = new ModelCatalog(connection);
    if (projects.size >= 64) projects.delete(projects.keys().next().value ?? "");
    projects.set(key, catalog);
  }
  return catalog;
}
export function invalidateModelCatalogs(connection: DaemonConnection) {
  for (const catalog of caches.get(connection)?.values() ?? []) catalog.invalidate();
}
