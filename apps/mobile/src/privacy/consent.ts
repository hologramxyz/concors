export const AI_CONSENT_VERSION = 1;
export const AI_CONSENT_KEY = "ai-sharing.v1";

export interface ConsentRecord {
  version: number;
  scope: string;
  acceptedAt: string;
}

/** Consent belongs to this account/organization (or private endpoint), not the device globally. */
export function hasAIConsent(raw: string | null, scope: string): boolean {
  if (!raw || !scope) return false;
  try {
    const record: unknown = JSON.parse(raw);
    if (!record || typeof record !== "object") return false;
    const value = record as Partial<ConsentRecord>;
    return (
      value.version === AI_CONSENT_VERSION &&
      value.scope === scope &&
      typeof value.acceptedAt === "string" &&
      Number.isFinite(Date.parse(value.acceptedAt))
    );
  } catch {
    return false;
  }
}

export function consentRecord(scope: string): string {
  if (!scope) throw new Error("Sign in before allowing AI data sharing.");
  return JSON.stringify({
    version: AI_CONSENT_VERSION,
    scope,
    acceptedAt: new Date().toISOString(),
  } satisfies ConsentRecord);
}
