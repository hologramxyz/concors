import { ApiError, createApiClient, memoryTokenStore } from "@concors/api-client";
import { inspectLivePrerequisites } from "../src/live-preflight.ts";
import { apiUrl } from "../src/runtime-config.ts";

// Supply an existing session via a private local environment/CI secret, never EXPO_PUBLIC_*.
// This command only reads account/machine/capability state: no provisioning or session creation.
async function main() {
  const token = process.env.CONCORS_PREFLIGHT_TOKEN;
  const machine = process.env.CONCORS_PREFLIGHT_MACHINE_ID;
  const baseUrl = process.env.CONCORS_PREFLIGHT_API_URL;
  if (!token || !machine || !baseUrl)
    throw new Error(
      "Set CONCORS_PREFLIGHT_API_URL, CONCORS_PREFLIGHT_MACHINE_ID and the private CONCORS_PREFLIGHT_TOKEN environment variable. Do not paste credentials into chat or command arguments.",
    );
  const api = createApiClient({
    baseUrl: apiUrl(baseUrl, false),
    tokenStore: memoryTokenStore(token),
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      }),
  });
  const result = await inspectLivePrerequisites(api, machine);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.readyToAttemptWorkspaceConnection) process.exitCode = 1;
}
main().catch((error) => {
  // Upstream response messages may contain secrets; only print a status for API failures.
  console.error(
    error instanceof ApiError
      ? `Preflight failed: API returned HTTP ${error.status}.`
      : error instanceof Error &&
          (error.message.startsWith("Set CONCORS_") ||
            error.message.startsWith("The selected machine") ||
            error.message.startsWith("Use an HTTPS"))
        ? error.message
        : "Preflight failed. Verify HTTPS configuration, network access and session credentials.",
  );
  process.exitCode = 1;
});
