import { env } from "@/config/env";
import { APP_VERSION } from "@/version";
import { useContext } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { BrandMark } from "@/components/brand-mark";
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
  const compact = useContext(CompactLayoutContext);
  return (
    <Section title="About">
      {compact && (
        <div className="mobile-settings-about">
          <BrandMark className="size-16" />
          <h3>Concors</h3>
          <p>Your workspace, wherever you are.</p>
        </div>
      )}
      <SettingsCard className="divide-y">
        <Row label="Version" inline>
          <Mono>{clientVersion}</Mono>
        </Row>
        {buildVersion !== undefined && (
          <Row label="Build number" inline>
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
