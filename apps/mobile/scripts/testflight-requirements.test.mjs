import { expect, it, vi } from "vitest";
import { inspectTestFlight } from "./testflight-requirements.mjs";
import { readFileSync } from "node:fs";

const eas = JSON.parse(readFileSync(new URL("../eas.json", import.meta.url), "utf8"));
const environment = {
  APP_VARIANT: "production",
  EXPO_PUBLIC_DEMO: "false",
  EXPO_PUBLIC_API_URL: "https://api.concors.dev",
  EXPO_PUBLIC_EAS_PROJECT_ID: "12345678-1234-4123-8123-123456789abc",
  EXPO_OWNER: "test-team",
  CONCORS_ASC_APP_ID: "1234567890",
};
const input = {
  eas,
  environment,
  version: "0.1.0",
  readiness: {
    schemaVersion: 1,
    appVersion: "0.1.0",
    releaseModel: "existing-account-companion",
    gates: [],
  },
};
const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });

it("allows internal beta preparation without claiming release or live acceptance", async () => {
  const request = vi.fn(async () => unauthorized());
  expect(await inspectTestFlight({ ...input, request })).toMatchObject({
    configurationValid: true,
    apiReachable: true,
    readyToRequestBuild: true,
    accountAccessVerified: false,
    signingVerified: false,
    liveWorkspaceVerified: false,
    failures: [],
  });
  expect(request).toHaveBeenCalledExactlyOnceWith("https://api.concors.dev/api/v1/me", {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    signal: expect.any(AbortSignal),
    headers: { Accept: "application/json" },
  });
});

it.each([
  { EXPO_PUBLIC_DEMO: "true" },
  { APP_VARIANT: "preview" },
  { CONCORS_IOS_PERSONAL_TEAM: "true" },
  { EXPO_PUBLIC_API_URL: "http://localhost:3000" },
  { EXPO_PUBLIC_API_URL: "https://private.tailnet.ts.net" },
  { EXPO_PUBLIC_API_URL: "https://secret@api.concors.dev" },
  { EXPO_PUBLIC_DEV_DAEMON_URL: "wss://private.tailnet.ts.net/ws" },
  { CONCORS_MOBILE_WEB_BASE_PATH: "/preview" },
  { CONCORS_ASC_APP_ID: "dev.concors.mobile" },
  { CONCORS_ASC_APP_ID: "" },
  { EXPO_PUBLIC_EAS_PROJECT_ID: "" },
  { EXPO_OWNER: "" },
])(
  "rejects incomplete or preview configuration before making any network request: %j",
  async (overrides) => {
    const request = vi.fn();
    const result = await inspectTestFlight({
      ...input,
      environment: { ...environment, ...overrides },
      request,
    });
    expect(result.configurationValid).toBe(false);
    expect(result.readyToRequestBuild).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret@");
  },
);

it.each([{ distribution: "internal" }, { developmentClient: true }, { ios: { simulator: true } }])(
  "rejects an ad-hoc, development or simulator candidate: %j",
  async (override) => {
    const result = await inspectTestFlight({
      ...input,
      offline: true,
      eas: {
        ...eas,
        build: { ...eas.build, candidate: { ...eas.build.candidate, ...override } },
      },
    });
    expect(result.configurationValid).toBe(false);
  },
);

it("checks the configured Apple ID when present", async () => {
  const result = await inspectTestFlight({
    ...input,
    offline: true,
    eas: {
      ...eas,
      submit: { candidate: { ios: { ascAppId: "9876543210" } } },
    },
  });
  expect(result.failures).toContain("CONCORS_ASC_APP_ID must match submit.candidate.ios.ascAppId");
});

it.each([
  { base: { ...eas.build.base, ios: { simulator: true } } },
  { base: { ...eas.build.base, developmentClient: true } },
  { candidate: { ...eas.build.candidate, extends: "missing" } },
  { base: { extends: "candidate" } },
])("validates inherited native build settings: %j", async (overrides) => {
  const result = await inspectTestFlight({
    ...input,
    offline: true,
    eas: { ...eas, build: { ...eas.build, ...overrides } },
  });
  expect(result.configurationValid).toBe(false);
});

it("labels an offline check without making a reachability claim", async () => {
  const request = vi.fn();
  expect(await inspectTestFlight({ ...input, offline: true, request })).toMatchObject({
    configurationValid: true,
    apiReachable: null,
    readyToRequestBuild: false,
    failures: [],
  });
  expect(request).not.toHaveBeenCalled();
});

it.each([
  () => new Response("marketing site", { status: 200 }),
  () => new Response("unauthorized", { status: 401 }),
  () => Response.json({ error: "Unavailable" }, { status: 503 }),
  () =>
    new Response("invalid json", { status: 401, headers: { "content-type": "application/json" } }),
  () => {
    throw new Error("private token must not appear in output");
  },
])(
  "fails closed on an unavailable API or unexpected response without printing upstream data",
  async (response) => {
    const result = await inspectTestFlight({ ...input, request: vi.fn(response) });
    expect(result.readyToRequestBuild).toBe(false);
    expect(result.apiReachable).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private token");
  },
);
