import type { ConnectionState, DaemonEndpoint } from "@concors/daemon-client";
import { PROTOCOL_VERSION } from "@concors/protocol";

import { Badge } from "@/components/ui/badge";
import { env } from "@/config/env";
import { APP_VERSION } from "@/version";
import { Mono, Row, Section } from "@/views/settings-primitives";

interface AdvancedSettingsProps {
  readonly endpoint: DaemonEndpoint | null;
  readonly state: ConnectionState;
  readonly apiUrl?: string;
  readonly endpointLabel?: string;
}

export function AdvancedSettings({
  endpoint,
  state,
  apiUrl = env.apiUrl,
  endpointLabel,
}: AdvancedSettingsProps) {
  return (
    <>
      <Section
        title="Daemon"
        description="The Concourse daemon runs your agents locally or on a remote machine."
      >
        <Row label="Endpoint">
          <span className="flex items-center gap-2">
            <Mono>{endpointLabel ?? endpoint?.url ?? "resolving…"}</Mono>
            {endpoint !== null && (
              <Badge variant="outline" className="tracking-wide uppercase">
                {endpoint.kind}
              </Badge>
            )}
          </span>
        </Row>
        <Row label="Status">
          <span className="capitalize">{state.status.replace("_", " ")}</span>
        </Row>
        <Row label="Daemon version">
          <Mono>{state.status === "ready" ? state.daemon.daemonVersion : "—"}</Mono>
        </Row>
        <Row label="Protocol" hint="Version negotiated with the daemon.">
          <Mono>{state.status === "ready" ? state.daemon.protocolVersion : PROTOCOL_VERSION}</Mono>
        </Row>
      </Section>

      <Section title="About">
        <Row label="Client version">
          <Mono>{APP_VERSION}</Mono>
        </Row>
        <Row
          label="Concourse API"
          hint="Control plane for accounts, organizations, and cloud machines."
        >
          <Mono>{apiUrl}</Mono>
        </Row>
      </Section>
    </>
  );
}
