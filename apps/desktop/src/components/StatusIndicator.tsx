import type { ConnectionState, DaemonEndpoint } from "@concors/daemon-client";

interface StatusIndicatorProps {
  readonly state: ConnectionState;
  readonly endpoint: DaemonEndpoint | null;
  readonly onReconnect: () => void;
}

/** Compact daemon connection status shown in the top bar. */
export function StatusIndicator({ state, endpoint, onReconnect }: StatusIndicatorProps) {
  const { label, tone } = describe(state);
  const canRetry = state.status === "disconnected" || state.status === "error";

  return (
    <div className="status" role="status" aria-live="polite">
      <span className={`status__dot status__dot--${tone}`} aria-hidden="true" />
      <span className="status__label">{label}</span>
      {endpoint !== null && (
        <span className="status__endpoint" title={endpoint.url}>
          {endpoint.kind === "local" ? "local" : "remote"}
        </span>
      )}
      {state.status === "ready" && (
        <span className="status__meta">
          daemon {state.daemon.daemonVersion} · {state.daemon.protocolVersion}
        </span>
      )}
      {canRetry && (
        <button type="button" className="status__retry" onClick={onReconnect}>
          Retry
        </button>
      )}
    </div>
  );
}

function describe(state: ConnectionState): { label: string; tone: "ok" | "busy" | "bad" | "idle" } {
  switch (state.status) {
    case "ready":
      return { label: "Connected", tone: "ok" };
    case "connecting":
      return { label: "Connecting…", tone: "busy" };
    case "handshaking":
      return { label: "Handshaking…", tone: "busy" };
    case "error":
      return { label: `Error: ${state.error.code}`, tone: "bad" };
    case "disconnected":
      return { label: "Disconnected", tone: "idle" };
  }
}
