import { ApiError } from "@concors/api-client";
import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentInfo, TerminalInfo, WorkspaceSnapshot } from "@concors/protocol";
/** A user action is required; repeating the same access request must not loop indefinitely. */
export class ConnectionAccessError extends Error {}
export interface ConnectionSnapshot {
  phase: "idle" | "connecting" | "ready" | "reconnecting" | "paused" | "error";
  transport: DaemonConnection | null;
  workspace: WorkspaceSnapshot | null;
  agents: readonly AgentInfo[];
  terminals: readonly TerminalInfo[];
  message: string | null;
}
/** One selected machine. The host supplies AppState/network availability. */
export class ConnectionController {
  private value: ConnectionSnapshot = {
    phase: "idle",
    transport: null,
    workspace: null,
    agents: [],
    terminals: [],
    message: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly create: (signal: AbortSignal) => Promise<DaemonConnection>;
  private readonly expectedMachineId: string | undefined;
  private available = false;
  private disposed = false;
  private generation = 0;
  private failures = 0;
  private authRetried = false;
  private blocked = false;
  private abort: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private connection: DaemonConnection | null = null;
  private cleanup: (() => void)[] = [];
  constructor(
    create: (signal: AbortSignal) => Promise<DaemonConnection>,
    expectedMachineId?: string,
  ) {
    this.create = create;
    this.expectedMachineId = expectedMachineId;
  }
  getSnapshot = (): ConnectionSnapshot => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(update: Partial<ConnectionSnapshot>): void {
    this.value = { ...this.value, ...update };
    for (const listener of this.listeners) listener();
  }
  setAvailable(available: boolean): void {
    if (this.disposed || available === this.available) return;
    this.available = available;
    this.stopAttempt();
    if (this.blocked) return;
    if (available) {
      this.failures = 0;
      void this.attempt();
    } else
      this.publish({
        phase: "paused",
        transport: null,
        message: "Connection paused. Reconnect when the app is active and online.",
      });
  }
  retry = (): void => {
    if (!this.available || this.disposed) return;
    this.stopAttempt();
    this.failures = 0;
    this.authRetried = false;
    this.blocked = false;
    void this.attempt();
  };
  dispose(): void {
    this.disposed = true;
    this.available = false;
    this.stopAttempt();
    this.listeners.clear();
  }
  private stopAttempt(): void {
    this.generation++;
    this.abort?.abort();
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    for (const off of this.cleanup) off();
    this.cleanup = [];
    this.connection?.disconnect();
    this.connection = null;
  }
  private failed(cause?: unknown, authentication = false, opaque = false): void {
    if (!this.available || this.disposed || this.blocked) return;
    authentication ||= cause instanceof ApiError && cause.status === 401;
    if (authentication || opaque) {
      if (this.authRetried)
        cause = new ConnectionAccessError(
          authentication
            ? "Access revoked"
            : "Could not connect after refreshing access. The machine may be offline or access revoked.",
        );
      this.authRetried = true;
    }
    this.stopAttempt();
    this.blocked = cause instanceof ConnectionAccessError;
    this.publish({
      phase: "error",
      transport: null,
      message:
        cause instanceof ConnectionAccessError
          ? cause.message
          : "Could not connect. Retrying automatically; your sessions stay on the machine.",
    });
    if (cause instanceof ConnectionAccessError) return;
    const delay = authentication || opaque ? 0 : Math.min(1000 * 2 ** this.failures++, 30_000);
    this.timer = setTimeout(() => {
      void this.attempt();
    }, delay);
  }
  private async attempt(): Promise<void> {
    if (!this.available || this.disposed || this.blocked) return;
    this.abort = new AbortController();
    const generation = ++this.generation;
    const current = () => !this.disposed && this.available && generation === this.generation;
    this.publish({
      phase: this.value.workspace ? "reconnecting" : "connecting",
      transport: null,
      message: null,
    });
    this.deadline = setTimeout(() => {
      if (current()) this.failed();
    }, 15_000);
    try {
      const connection = await this.create(this.abort.signal);
      if (!current()) {
        connection.disconnect();
        return;
      }
      this.connection = connection;
      this.cleanup.push(
        connection.subscribe((state) => {
          if (!current()) return;
          if (state.status === "ready") this.authRetried = false;
          if (state.status === "disconnected") this.failed(undefined, state.closeCode === 4401);
          if (state.status === "error") {
            const details = state.error.details as Record<string, unknown> | undefined;
            this.failed(
              undefined,
              details?.["closeCode"] === 4401 || details?.["status"] === 401,
              details?.["websocketUpgradeFailed"] === true,
            );
          }
        }),
      );
      this.cleanup.push(
        connection.subscribeWorkspace((workspace) => {
          if (!current()) return;
          if (this.expectedMachineId && workspace.machineId !== this.expectedMachineId) {
            this.failed();
            return;
          }
          clearTimeout(this.deadline);
          this.failures = 0;
          this.publish({ phase: "ready", transport: connection, workspace, message: null });
        }),
      );
      this.cleanup.push(
        connection.onAgent(() => {
          if (current()) this.publish({ agents: [...connection.agents] });
        }),
      );
      this.cleanup.push(
        connection.subscribeTerminalSessions(() => {
          if (current()) this.publish({ terminals: [...connection.terminals] });
        }),
      );
      await connection.connect();
      if (current())
        void connection.requestTerminal({ kind: "list" }, newRequestId()).catch(() => {
          /* Snapshots may arrive separately. */
        });
    } catch (cause) {
      if (current()) this.failed(cause);
    }
  }
}
// React Native supplies expo-crypto; browsers use Web Crypto.
let requestId = () => globalThis.crypto.randomUUID() as string;
export function configureRequestIds(factory: () => string): void {
  requestId = factory;
}
export function newRequestId(): string {
  return requestId();
}
