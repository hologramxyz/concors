import { candidateFailures } from "./release-requirements.mjs";

function buildProfile(profiles, name, seen = new Set()) {
  const profile = profiles?.[name];
  if (!profile || seen.has(name)) throw new Error("Invalid build profile inheritance");
  seen.add(name);
  const parent = profile.extends ? buildProfile(profiles, profile.extends, seen) : {};
  return {
    ...parent,
    ...profile,
    ios: { ...parent.ios, ...profile.ios },
    env: { ...parent.env, ...profile.env },
  };
}

/** Read-only beta preflight. Never signs in, creates an app, provisions a machine or uploads. */
export async function inspectTestFlight({
  readiness,
  environment,
  version,
  eas,
  offline = false,
  request = fetch,
}) {
  const failures = candidateFailures(readiness, environment, version);
  let candidate;
  try {
    candidate = buildProfile(eas?.build, "candidate");
  } catch {
    failures.push(
      "Candidate build profile inheritance must resolve without cycles or missing profiles",
    );
  }
  if (
    candidate?.distribution !== "store" ||
    candidate?.environment !== "production" ||
    candidate?.autoIncrement !== true ||
    candidate?.env?.APP_VARIANT !== "production" ||
    candidate?.env?.EXPO_PUBLIC_DEMO !== "false" ||
    candidate?.developmentClient === true ||
    candidate?.ios?.simulator === true
  )
    failures.push("Use the store-distribution candidate profile for a physical-device beta");
  if (environment.CONCORS_MOBILE_WEB_BASE_PATH) failures.push("Remove the web preview base path");
  const configuredId = eas?.submit?.candidate?.ios?.ascAppId;
  const appId = configuredId ?? environment.CONCORS_ASC_APP_ID;
  if (!/^[1-9][0-9]+$/.test(String(appId ?? "")))
    failures.push("Set CONCORS_ASC_APP_ID to the numeric Apple ID from App Store Connect");
  if (
    configuredId &&
    environment.CONCORS_ASC_APP_ID &&
    String(configuredId) !== environment.CONCORS_ASC_APP_ID
  )
    failures.push("CONCORS_ASC_APP_ID must match submit.candidate.ios.ascAppId");

  const configurationValid = failures.length === 0;
  let apiReachable = null;
  if (configurationValid && !offline) {
    apiReachable = false;
    try {
      const response = await request(
        `${environment.EXPO_PUBLIC_API_URL.replace(/\/$/, "")}/api/v1/me`,
        {
          method: "GET",
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: { Accept: "application/json" },
        },
      );
      // No credentials are sent: the protected account route must refuse access with JSON.
      // A marketing site returning HTTP 200 is not a working control plane.
      if (response.status === 401 && response.headers.get("content-type")?.includes("json")) {
        const body = await response.json();
        apiReachable = !!body && typeof body === "object" && !Array.isArray(body);
      }
    } catch {
      // Do not expose response bodies, URLs, exception messages or credentials in reports.
    }
    if (!apiReachable)
      failures.push(
        "API probe failed: /api/v1/me must be reachable over HTTPS and return JSON 401 without credentials",
      );
  }
  return {
    check: "testflight-preflight",
    configurationValid,
    apiReachable,
    readyToRequestBuild: configurationValid && apiReachable === true,
    accountAccessVerified: false,
    signingVerified: false,
    liveWorkspaceVerified: false,
    failures,
  };
}
