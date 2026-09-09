export const requiredGates = [
  "developer-accounts",
  "production-auth",
  "production-workspace",
  "account-deletion",
  "public-pages",
  "push",
  "domain-links",
  "physical-devices",
  "store-material",
  "commerce-policy",
  "play-production-access",
  "ai-data-and-safety",
  "native-privacy-and-permissions",
];

/** Workflow checks, not a substitute for store/legal review or signed-device evidence. */
export function releaseFailures(readiness, environment) {
  const failures = [];
  if (!readiness || readiness.schemaVersion !== 1 || !Array.isArray(readiness.gates))
    return ["Invalid release evidence document (schemaVersion 1 and gates are required)"];
  if (!["existing-account-companion", "signup-and-purchasing"].includes(readiness.releaseModel))
    failures.push("Record the approved first-release scope and storefront commerce policy");
  if (!/^\d+\.\d+\.\d+$/.test(readiness.appVersion ?? ""))
    failures.push("Record the app version under review");
  const ids = readiness.gates.map((gate) => gate?.id);
  if (new Set(ids).size !== ids.length) failures.push("Release gate IDs must be unique");
  for (const id of requiredGates) {
    const gate = readiness.gates.find((item) => item?.id === id);
    if (!gate) {
      failures.push(`Missing required release gate: ${id}`);
      continue;
    }
    if (gate.status !== "verified") {
      failures.push(
        `${gate.title ?? id} [${gate.owner ?? "owner needed"}]: ${gate.status ?? "pending"}`,
      );
      continue;
    }
    if (
      typeof gate.verifiedBy !== "string" ||
      !gate.verifiedBy.trim() ||
      typeof gate.verifiedAt !== "string" ||
      !Number.isFinite(Date.parse(gate.verifiedAt)) ||
      !Array.isArray(gate.evidence) ||
      !gate.evidence.length ||
      !gate.evidence.every((item) => typeof item === "string" && item.trim().length > 0)
    )
      failures.push(`${gate.title ?? id}: verification needs a named reviewer, date and evidence`);
  }
  for (const gate of readiness.gates) {
    if (!requiredGates.includes(gate?.id)) failures.push(`Unknown release gate: ${gate?.id}`);
  }
  if (environment.APP_VARIANT !== "production") failures.push("Set APP_VARIANT=production");
  if (environment.EXPO_PUBLIC_DEMO !== "false")
    failures.push("Explicitly set EXPO_PUBLIC_DEMO=false");
  if (environment.EXPO_PUBLIC_DEV_DAEMON_URL)
    failures.push("Remove the development daemon override");
  try {
    const api = new URL(environment.EXPO_PUBLIC_API_URL ?? "");
    if (
      api.protocol !== "https:" ||
      api.username ||
      api.password ||
      api.search ||
      api.hash ||
      /^(localhost|127\.|\[::1\])/.test(api.hostname) ||
      /\.(localhost|local|invalid|test|example)$/.test(api.hostname)
    )
      throw new Error("Not a production API endpoint");
  } catch {
    failures.push("Configure a production HTTPS EXPO_PUBLIC_API_URL without credentials/query");
  }
  const projectId = environment.EXPO_PUBLIC_EAS_PROJECT_ID ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId))
    failures.push("Link the team's Expo project with EXPO_PUBLIC_EAS_PROJECT_ID");
  return failures;
}
