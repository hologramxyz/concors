import type { AgentProviderCatalog } from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";

/** Memory-only, scoped to a connection and project directory; never shared across machines. */
export class ProviderCatalogCache {
  private snapshot: AgentProviderCatalog[] = [];
  private listeners = new Set<() => void>();
  private pending = new Map<string, Promise<void>>();
  private generation = 0;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  clear = () => {
    this.generation++;
    this.pending.clear();
    this.snapshot = [];
    this.emit();
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  load(provider: string, request: () => Promise<AgentProviderCatalog[]>): Promise<void> {
    const pending = this.pending.get(provider);
    if (pending) return pending;
    const generation = this.generation;
    const job = Promise.resolve()
      .then(request)
      .then((result) => {
        if (generation !== this.generation) return;
        const currentRevision = this.snapshot[0]?.revision;
        const nextRevision = result[0]?.revision;
        if (currentRevision && nextRevision) {
          const current = currentRevision.split(":").map(Number);
          const next = nextRevision.split(":").map(Number);
          // A slow pre-sign-in/config response cannot revive the previous catalog.
          if (
            (next[0] ?? 0) < (current[0] ?? 0) ||
            (next[0] === current[0] && (next[1] ?? 0) < (current[1] ?? 0))
          )
            return;
        }
        this.snapshot = result.map((row) => {
          const previous = this.snapshot.find(
            (p) => p.id === row.id && p.revision === row.revision,
          );
          // An unselected provider row is only a lightweight discovery placeholder.
          if (!row.loaded && previous?.loaded)
            return { ...previous, label: row.label ?? previous.label };
          // Unselected rows may be server-side cache snapshots captured before
          // another concurrent provider refresh completed.
          if (row.id !== provider && previous?.loaded) return previous;
          if (row.error && previous?.models.length) return { ...row, models: previous.models };
          return row;
        });
        this.emit();
      })
      .finally(() => {
        if (this.pending.get(provider) === job) this.pending.delete(provider);
      });
    this.pending.set(provider, job);
    return job;
  }
}

const caches = new WeakMap<DaemonConnection, Map<string, ProviderCatalogCache>>();
export function providerCatalogCache(connection: DaemonConnection, directory: string) {
  let scopes = caches.get(connection);
  if (!scopes) {
    scopes = new Map();
    caches.set(connection, scopes);
    const entries = scopes;
    connection.subscribe((state) => {
      if (state.status !== "ready") for (const cache of entries.values()) cache.clear();
    });
  }
  let cache = scopes.get(directory);
  if (!cache) {
    cache = new ProviderCatalogCache();
    // Only metadata is retained, with a bounded number of project scopes.
    if (scopes.size >= 64) scopes.delete(scopes.keys().next().value ?? "");
    scopes.set(directory, cache);
  }
  return cache;
}
