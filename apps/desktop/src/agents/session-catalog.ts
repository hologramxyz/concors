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
  error: string | null;
}
export interface SessionCatalogSnapshot {
  sessions: ProviderSession[];
  providers: (SessionProvider & { loading: boolean; hasMore: boolean; error: string | null })[];
}

/** Independent provider pages, with bounded parallelism and no all-or-nothing loading state. */
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
    initial: (provider: string) => NativeSessionPage | undefined,
  ) {
    this.read = read;
    this.entries = providers.map((provider) => {
      const page = initial(provider.id);
      return {
        provider,
        sessions: page?.sessions ?? [],
        cursor: page?.nextCursor,
        loaded: !!page,
        loading: false,
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
    this.enqueue(this.entries.filter((entry) => !entry.loaded));
  };
  stop = () => {
    this.active = false;
    this.generation++;
    this.queue = [];
    this.running = 0;
    for (const entry of this.entries) entry.loading = false;
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
      if (entry.loading || entry.cursor === null) continue;
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
      void this.read(entry.provider.id, entry.cursor ?? undefined)
        .then(
          (page) => {
            if (!this.active || generation !== this.generation) return;
            entry.sessions = mergeSessions(entry.sessions, page.sessions);
            entry.cursor = page.nextCursor === entry.cursor ? null : page.nextCursor;
            entry.loaded = true;
          },
          (cause: unknown) => {
            if (!this.active || generation !== this.generation) return;
            entry.error = cause instanceof Error ? cause.message : "Could not load sessions";
          },
        )
        .finally(() => {
          if (!this.active || generation !== this.generation) return;
          entry.loading = false;
          this.running--;
          this.publish();
          this.pump();
        });
    }
  }
}
