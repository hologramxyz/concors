export interface ResourceSnapshot<T> {
  data: T | null;
  error: unknown;
  pending: boolean;
  revision: number;
  /** When `data` was read or written; time-sensitive fields must be judged against this. */
  fetchedAt: number | null;
}

/** In-memory stale-while-revalidate data. A mutation supersedes any older read. */
export class Resource<T> {
  private snapshot: ResourceSnapshot<T> = {
    data: null,
    error: null,
    pending: false,
    revision: 0,
    fetchedAt: null,
  };
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  private generation = 0;
  private updatedAt = -Infinity;
  private readonly discardOnError: (error: unknown) => boolean;
  private readonly request: () => Promise<T>;
  constructor(
    request: () => Promise<T>,
    discardOnError: (error: unknown) => boolean = () => false,
  ) {
    this.request = request;
    this.discardOnError = discardOnError;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: Partial<ResourceSnapshot<T>>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }
  load = (staleTime = 30_000, force = false): Promise<void> => {
    if (this.pending) return this.pending;
    if (!force && Date.now() - this.updatedAt < staleTime) return Promise.resolve();
    const generation = this.generation;
    this.publish({ pending: true, error: null });
    const job = Promise.resolve()
      .then(this.request)
      .then(
        (data) => {
          if (generation !== this.generation) return;
          this.updatedAt = Date.now();
          this.publish({ data, error: null, pending: false, fetchedAt: this.updatedAt });
        },
        (error: unknown) => {
          if (generation === this.generation) {
            this.updatedAt = -Infinity;
            this.publish({
              ...(this.discardOnError(error) ? { data: null, fetchedAt: null } : {}),
              error,
              pending: false,
            });
          }
        },
      )
      .finally(() => {
        if (this.pending === job) this.pending = null;
      });
    this.pending = job;
    return job;
  };
  set = (update: T | ((previous: T | null) => T)) => {
    this.generation++;
    this.pending = null;
    this.updatedAt = Date.now();
    this.publish({
      data:
        typeof update === "function"
          ? (update as (previous: T | null) => T)(this.snapshot.data)
          : update,
      error: null,
      pending: false,
      fetchedAt: this.updatedAt,
    });
  };
  dispose() {
    this.generation++;
    this.pending = null;
    this.updatedAt = -Infinity;
    this.snapshot = { data: null, error: null, pending: false, revision: 0, fetchedAt: null };
    this.listeners.clear();
  }

  invalidate = (clear = false) => {
    this.generation++;
    this.pending = null;
    this.updatedAt = -Infinity;
    this.publish({
      ...(clear ? { data: null, fetchedAt: null } : {}),
      error: null,
      pending: false,
      revision: this.snapshot.revision + 1,
    });
  };
}

export class ResourceCache {
  private entries = new Map<string, { invalidate(clear?: boolean): void; dispose(): void }>();
  private readonly discardOnError: (error: unknown) => boolean;
  constructor(discardOnError: (error: unknown) => boolean = () => false) {
    this.discardOnError = discardOnError;
  }
  resource<T>(key: string, request: () => Promise<T>): Resource<T> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = new Resource(request, this.discardOnError);
      this.entries.set(key, entry);
    }
    return entry as Resource<T>;
  }
  invalidate(prefix: string, clear = false) {
    for (const [key, entry] of this.entries) if (key.startsWith(prefix)) entry.invalidate(clear);
  }
  clear() {
    for (const entry of this.entries.values()) entry.dispose();
    this.entries.clear();
  }
}
