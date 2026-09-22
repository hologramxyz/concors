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
    <Section title="About" description="Version and service details for this Concors client.">
      <SettingsCard className="divide-y">
        <Row label="Client version">
          <Mono>{clientVersion}</Mono>
        </Row>
        {buildVersion !== undefined && (
          <Row label="Build number">
            <Mono>{buildVersion ?? "Development / browser preview"}</Mono>
          </Row>
        )}
        <Row
          label="Concors API"
          hint="Control plane for accounts, organizations, and cloud machines."
        >
          <Mono>{apiUrl}</Mono>
        </Row>
      </SettingsCard>
    </Section>
  );
}
