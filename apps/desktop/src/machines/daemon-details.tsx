import type { ConnectionState, DaemonEndpoint } from "@concors/daemon-client";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

/** The live connection to the daemon of the machine the app currently has selected. */
export interface DaemonConnectionInfo {
  readonly endpoint: DaemonEndpoint | null;
  readonly endpointLabel?: string | undefined;
  readonly state: ConnectionState;
}

/**
 * What is known about one machine's daemon. Only the selected machine has a live connection, so
 * the others show what the control plane last heard from them.
 */
export function DaemonDetails({
  connection,
  reportedVersion,
  seenAt,
  error,
}: {
  readonly connection?: DaemonConnectionInfo | undefined;
  /** The version the daemon last reported to the control plane (cloud machines only). */
  readonly reportedVersion?: string | null | undefined;
  readonly seenAt?: string | null | undefined;
  readonly error?: string | null | undefined;
}) {
  const ready = connection?.state.status === "ready" ? connection.state.daemon : null;
  const version = ready?.daemonVersion ?? reportedVersion ?? null;
  return (
    <div className="min-w-0 space-y-3 text-xs">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Detail label="Status">
          {connection ? (
            <span className="capitalize">{connection.state.status.replace("_", " ")}</span>
          ) : (
            <span>
              Not connected
              {seenAt && (
                <span className="text-muted-foreground">
                  {" "}
                  · last seen{" "}
                  {new Date(seenAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              )}
            </span>
          )}
        </Detail>
        <Detail label="Daemon version">
          <span className="font-mono">{version ?? "—"}</span>
        </Detail>
        {connection && (
          <>
            <Detail label="Endpoint">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-mono break-all">
                  {connection.endpointLabel ?? connection.endpoint?.url ?? "resolving…"}
                </span>
                {connection.endpoint && (
                  <Badge variant="outline" className="tracking-wide uppercase">
                    {connection.endpoint.kind}
                  </Badge>
                )}
              </span>
            </Detail>
            <Detail label="Protocol">
              <span className="font-mono">{ready?.protocolVersion ?? "—"}</span>
            </Detail>
          </>
        )}
      </dl>
      {!connection && (
        <p className="text-muted-foreground">
          Switch to this machine for its live connection details.
        </p>
      )}
      {error && (
        <p role="alert" className="selectable break-words text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Detail({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="selectable min-w-0">{children}</dd>
    </div>
  );
}
