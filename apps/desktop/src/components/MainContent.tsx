import type { ConnectionState } from "@concors/daemon-client";

interface MainContentProps {
  readonly state: ConnectionState;
}

/** Main area placeholder. Agent sessions will live here. */
export function MainContent({ state }: MainContentProps) {
  return (
    <div className="placeholder">
      <h1 className="placeholder__title">Welcome to Concors</h1>
      <p className="placeholder__text">
        A cross-platform client and runtime for orchestrating coding agents locally and in the
        cloud.
      </p>

      {state.status === "ready" ? (
        <p className="placeholder__text">
          Connected to daemon <code>{state.daemon.daemonVersion}</code> speaking protocol{" "}
          <code>{state.daemon.protocolVersion}</code>. Agent sessions are not implemented yet.
        </p>
      ) : (
        <p className="placeholder__text placeholder__text--muted">
          Waiting for a daemon. In development, start one with <code>pnpm daemon:dev</code>.
        </p>
      )}
    </div>
  );
}
