import type { DaemonEndpoint } from "@concors/daemon-client";

import { env } from "../config/env.ts";
import { APP_VERSION } from "../version.ts";

interface SettingsPanelProps {
  readonly endpoint: DaemonEndpoint | null;
}

/** Settings placeholder: read-only view of the effective configuration for now. */
export function SettingsPanel({ endpoint }: SettingsPanelProps) {
  return (
    <div className="settings">
      <h1 className="placeholder__title">Settings</h1>
      <p className="placeholder__text placeholder__text--muted">
        Nothing is editable yet. This shows the configuration the app is currently using.
      </p>

      <dl className="settings__list">
        <dt>Client version</dt>
        <dd>
          <code>{APP_VERSION}</code>
        </dd>

        <dt>Daemon endpoint</dt>
        <dd>
          <code>{endpoint?.url ?? "resolving…"}</code>
          {endpoint !== null && <span className="settings__hint"> ({endpoint.kind})</span>}
        </dd>

        <dt>Concors API</dt>
        <dd>
          <code>{env.apiUrl}</code>
        </dd>
      </dl>
    </div>
  );
}
