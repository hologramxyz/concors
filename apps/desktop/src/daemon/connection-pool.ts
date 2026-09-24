import type { ConnectionState, DaemonConnection } from "@concors/daemon-client";
import type { WorkspaceSnapshot } from "@concors/protocol";

/**
 * Keeps recently used machine connections open after the UI lets go of them, so switching back
 * to a machine (or reopening a page that talks to several) shows its live workspace at once
 * instead of minting a token, reconnecting and waiting for a fresh snapshot.
 *
 * It does not decide how a connection retries or authenticates; that stays with the session the
 * caller opens. Connections of another account scope are never kept.
 */
export interface HostSnapshot {
  readonly transport: DaemonConnection | null;
  readonly state: ConnectionState;
  /** When an established connection started restoring itself; null while it is not. */
  readonly restoringSince: number | null;
  readonly workspace: WorkspaceSnapshot | null;
  readonly workspaceReady: boolean;
}

export interface HostSession {
  reconnect(): void;
  resume(): void;
  offline(): void;
  dispose(): void;
}

export interface HostHandlers {
  onTransport(connection: DaemonConnection | null): void;
  onState(state: ConnectionState, restoring: boolean): void;
  onWorkspace(snapshot: WorkspaceSnapshot): void;
}

export const DISCONNECTED: HostSnapshot = {
  transport: null,
  state: { status: "disconnected" },
  restoringSince: null,
  workspace: null,
  workspaceReady: false,
};

export interface HostTarget {
  /** Identifies one connection: account scope, machine and endpoint. */
  readonly key: string;
  readonly scope: string;
  readonly machineId: string;
}

interface Entry extends HostTarget {
  session: HostSession | null;
  snapshot: HostSnapshot;
  readonly listeners: Set<() => void>;
  users: number;
  idleSince: number;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface PoolOptions {
  /** How long an unused connection stays open. */
  readonly idleMs: number;
  /** Unused connections beyond this are closed, oldest first. */
  readonly maxIdle: number;
  readonly now?: () => number;
}

export class HostConnectionPool {
  readonly #entries = new Map<string, Entry>();
  readonly #watchers = new Set<() => void>();
  readonly #options: PoolOptions;
  #scope: string | null = null;

  constructor(options: PoolOptions) {
    this.#options = options;
  }

  #now() {
    return this.#options.now?.() ?? Date.now();
  }

  /** The current snapshot of a connection, if one is open. Safe to call during render. */
  peek(key: string): HostSnapshot | undefined {
    return this.#entries.get(key)?.snapshot;
  }

  /**
   * Machines with a completed handshake right now, in use or idle. A live socket is better
   * evidence that a machine is up than a heartbeat timestamp.
   */
  readyMachines(scope: string): ReadonlySet<string> {
    const ready = new Set<string>();
    for (const entry of this.#entries.values())
      if (entry.scope === scope && entry.snapshot.state.status === "ready")
        ready.add(entry.machineId);
    return ready;
  }

  /** Hears every change to any connection, including one closing. */
  watch(listener: () => void): () => void {
    this.#watchers.add(listener);
    return () => {
      this.#watchers.delete(listener);
    };
  }

  #changed() {
    for (const watcher of [...this.#watchers]) watcher();
  }

  /** Closes unused connections that belong to another account or organization. */
  setScope(scope: string) {
    this.#scope = scope;
    for (const entry of [...this.#entries.values()])
      if (entry.users === 0 && entry.scope !== scope) this.#close(entry);
  }

  /**
   * Uses the open connection for `key`, or opens one. `listener` hears every snapshot change.
   * The returned function gives the connection back; it then idles instead of closing.
   */
  acquire(
    target: HostTarget,
    open: (handlers: HostHandlers) => HostSession,
    listener: () => void,
  ): () => void {
    let entry = this.#entries.get(target.key);
    if (entry) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
      // Coming back to a machine is a fresh intent to reach it: skip whatever backoff was left.
      const status = entry.snapshot.state.status;
      if (entry.users === 0 && (status === "error" || status === "disconnected"))
        entry.session?.reconnect();
    } else {
      entry = this.#open(target, open);
    }
    entry.users++;
    entry.listeners.add(listener);
    const acquired = entry;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      acquired.listeners.delete(listener);
      this.#release(acquired);
    };
  }

  #open(target: HostTarget, open: (handlers: HostHandlers) => HostSession): Entry {
    const { key } = target;
    const entry: Entry = {
      ...target,
      session: null,
      snapshot: DISCONNECTED,
      listeners: new Set(),
      users: 0,
      idleSince: 0,
      idleTimer: undefined,
    };
    const publish = (next: Partial<HostSnapshot>) => {
      if (this.#entries.get(key) !== entry) return;
      entry.snapshot = { ...entry.snapshot, ...next };
      for (const listener of [...entry.listeners]) listener();
      this.#changed();
    };
    this.#entries.set(key, entry);
    entry.session = open({
      onTransport: (transport) => publish({ transport }),
      onState: (state, restoring) =>
        publish({
          state,
          restoringSince: restoring ? (entry.snapshot.restoringSince ?? this.#now()) : null,
          ...(state.status === "ready" ? {} : { workspaceReady: false }),
        }),
      onWorkspace: (workspace) => publish({ workspace, workspaceReady: true }),
    });
    return entry;
  }

  #release(entry: Entry) {
    entry.users--;
    if (entry.users > 0 || this.#entries.get(entry.key) !== entry) return;
    if (this.#scope !== null && entry.scope !== this.#scope) {
      this.#close(entry);
      return;
    }
    entry.idleSince = this.#now();
    entry.idleTimer = setTimeout(() => this.#close(entry), this.#options.idleMs);
    const idle = [...this.#entries.values()]
      .filter((candidate) => candidate.users === 0)
      .sort((a, b) => a.idleSince - b.idleSince);
    for (const stale of idle.slice(0, Math.max(0, idle.length - this.#options.maxIdle)))
      this.#close(stale);
  }

  #close(entry: Entry) {
    if (this.#entries.get(entry.key) !== entry) return;
    clearTimeout(entry.idleTimer);
    this.#entries.delete(entry.key);
    entry.listeners.clear();
    entry.session?.dispose();
    this.#changed();
  }

  /** The OS lost connectivity: each session decides whether its socket is really gone. */
  offline() {
    for (const entry of this.#entries.values()) entry.session?.offline();
  }

  resume() {
    for (const entry of this.#entries.values()) entry.session?.resume();
  }

  reconnect(key: string) {
    this.#entries.get(key)?.session?.reconnect();
  }
}
