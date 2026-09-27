import type { NativeSession, NativeSessionPage } from "@concors/protocol";
import { mergeSessions } from "./session-cache";

export interface SessionProvider {
  id: string;
  label: string;
}
export interface ProviderSession extends NativeSession {
  provider: string;
  providerLabel: string;
}
interface Entry {
  provider: SessionProvider;
  sessions: NativeSession[];
  cursor: string | null | undefined;
  loaded: boolean;
  loading: boolean;
  /** Shown from an earlier visit while its first page is fetched again, without a spinner. */
  stale: boolean;
  revalidating: boolean;
  error: string | null;
}
export interface SessionCatalogSnapshot {
  sessions: ProviderSession[];
  providers: (SessionProvider & { loading: boolean; hasMore: boolean; error: string | null })[];
}

/**
 * Independent provider pages, with bounded parallelism and no all-or-nothing loading state. A
 * list seen before shows at once and refreshes quietly: listing can mean starting a CLI.
 */
export class SessionCatalog {
  private entries: Entry[];
  private listeners = new Set<() => void>();
  private queue: Entry[] = [];
  private running = 0;
  private generation = 0;
  private active = false;
  private snapshot: SessionCatalogSnapshot;
  private read: (provider: string, cursor?: string) => Promise<NativeSessionPage>;
  constructor(
    providers: SessionProvider[],
    read: SessionCatalog["read"],
    initial: (provider: string) => { page: NativeSessionPage; stale: boolean } | undefined,
  ) {
    this.read = read;
    this.entries = providers.map((provider) => {
      const cached = initial(provider.id);
      return {
        provider,
        sessions: cached?.page.sessions ?? [],
        cursor: cached?.page.nextCursor,
        loaded: !!cached,
        loading: false,
        stale: !!cached?.stale,
        revalidating: false,
        error: null,
      };
    });
    this.snapshot = this.build();
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private build(): SessionCatalogSnapshot {
    return {
      sessions: this.entries
        .flatMap((entry) =>
          entry.sessions.map((session) => ({
            ...session,
            provider: entry.provider.id,
            providerLabel: entry.provider.label,
          })),
        )
        .sort(
          (a, b) =>
            Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
            a.provider.localeCompare(b.provider) ||
            a.id.localeCompare(b.id),
        ),
      providers: this.entries.map((entry) => ({
        ...entry.provider,
        loading: entry.loading,
        hasMore: entry.cursor !== null,
        error: entry.error,
      })),
    };
  }
  private publish() {
    this.snapshot = this.build();
    for (const listener of this.listeners) listener();
  }
  start = () => {
    this.active = true;
    for (const entry of this.entries)
      if (entry.stale && !entry.revalidating) {
        entry.revalidating = true;
        this.queue.push(entry);
      }
    this.enqueue(this.entries.filter((entry) => !entry.loaded));
  };
  stop = () => {
    this.active = false;
    this.generation++;
    this.queue = [];
    this.running = 0;
    for (const entry of this.entries) entry.loading = entry.revalidating = false;
  };
  loadMore = (provider?: string) => {
    this.enqueue(
      this.entries.filter((entry) => (!provider || entry.provider.id === provider) && !entry.error),
    );
  };
  retry = (provider: string) => {
    const entry = this.entries.find((item) => item.provider.id === provider);
    if (!entry) return;
    entry.error = null;
    this.enqueue([entry]);
  };
  private enqueue(entries: Entry[]) {
    if (!this.active) return;
    for (const entry of entries) {
      // A page fetched past a list being refreshed would be dropped when the refresh lands.
      if (entry.loading || entry.revalidating || entry.cursor === null) continue;
      entry.loading = true;
      this.queue.push(entry);
    }
    this.publish();
    this.pump();
  }
  private pump() {
    const generation = this.generation;
    while (this.active && this.running < 3 && this.queue.length) {
      const entry = this.queue.shift();
      if (!entry) return;
      this.running++;
      const revalidating = entry.revalidating;
      void this.read(entry.provider.id, revalidating ? undefined : (entry.cursor ?? undefined))
        .then(
          (page) => {
            if (!this.active || generation !== this.generation) return;
            if (revalidating) {
              entry.sessions = mergeSessions([], page.sessions);
              entry.cursor = page.nextCursor;
              entry.stale = false;
              return;
            }
            entry.sessions = mergeSessions(entry.sessions, page.sessions);
            entry.cursor = page.nextCursor === entry.cursor ? null : page.nextCursor;
            entry.loaded = true;
          },
          (cause: unknown) => {
            if (!this.active || generation !== this.generation) return;
            // The earlier list stays up; only a list never shown reports the failure.
            if (!revalidating)
              entry.error = cause instanceof Error ? cause.message : "Could not load sessions";
          },
        )
        .finally(() => {
          if (!this.active || generation !== this.generation) return;
          entry.loading = entry.revalidating = false;
          this.running--;
          this.publish();
          this.pump();
        });
    }
  }
}
