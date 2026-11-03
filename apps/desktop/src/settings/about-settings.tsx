import { env } from "@/config/env";
import { APP_VERSION } from "@/version";
import { Mono, Row, Section, SettingsCard } from "@/views/settings-primitives";

interface AboutSettingsProps {
  readonly apiUrl?: string;
  readonly clientVersion?: string;
  readonly buildVersion?: string | null;
}

/** This Concors client. Daemon details live with each machine on the Machines page. */
export function AboutSettings({
  apiUrl = env.apiUrl,
  clientVersion = APP_VERSION,
  buildVersion,
}: AboutSettingsProps) {
  return (
    <Section title="About">
      <SettingsCard className="divide-y">
        <Row label="Version">
          <Mono>{clientVersion}</Mono>
        </Row>
        {buildVersion !== undefined && (
          <Row label="Build number">
            <Mono>{buildVersion ?? "Development / browser preview"}</Mono>
          </Row>
        )}
        <Row label="Concors API">
          <Mono>{apiUrl}</Mono>
        </Row>
      </SettingsCard>
    </Section>
  );
}
