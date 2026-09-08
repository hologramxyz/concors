import { test, expect, type Page } from "@playwright/test";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";

// Specs share isolated daemons, but their PTYs must not accumulate toward the runtime limit.
test.beforeEach(async () => {
  for (const port of [7429, 7430]) {
    const connection = new DaemonConnection({
      endpoint: describeDaemonEndpoint(`ws://127.0.0.1:${port}/ws`),
      client: { kind: "test", name: "terminal cleanup", version: "0.0.0" },
    });
    const unsubscribe = connection.subscribeWorkspace(() => undefined);
    try {
      await connection.connect();
      await expect.poll(() => connection.workspace).not.toBeNull();
      const result = await connection.requestTerminal({ kind: "list" }, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      for (const session of result.outcome.sessions) {
        if (session.status !== "running" && session.status !== "starting") continue;
        const stopped = await connection.requestTerminal(
          { kind: "stop", sessionId: session.id },
          crypto.randomUUID(),
        );
        expect(stopped.outcome.status).toBe("ok");
      }
    } finally {
      unsubscribe();
      connection.disconnect();
    }
  }
});

const TOKEN_KEY = "concors.auth.session-token.v1";

/**
 * The app renders nothing but the sign-in screen until the control plane confirms a session. Specs
 * that are about the workspace, not about auth, call this before `goto`: it preloads a saved token
 * and answers the API as an already-signed-in user, at the network layer. `auth.spec.ts` covers the
 * real sign-in flow.
 */
export async function signedIn(page: Page, name = "E2E User"): Promise<void> {
  await page.addInitScript(([key, token]: [string, string]) => localStorage.setItem(key, token), [
    TOKEN_KEY,
    "e2e-session-token",
  ] as [string, string]);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const origin = request.headers()["origin"] ?? "*";
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname;
    const body =
      path === "/api/v1/me"
        ? {
            user: {
              id: "e2e-user",
              name,
              email: "e2e@example.com",
              emailVerified: true,
              image: null,
              createdAt: "2026-09-07T00:00:00.000Z",
              updatedAt: "2026-09-07T00:00:00.000Z",
            },
            session: {
              id: "e2e-session",
              expiresAt: "2036-01-01T00:00:00.000Z",
              activeOrganizationId: "e2e-org",
            },
          }
        : path === "/api/v1/organizations"
          ? {
              organizations: [
                {
                  id: "e2e-org",
                  name: "e2e",
                  slug: "e2e",
                  logo: null,
                  isPersonal: true,
                  role: "owner",
                  createdAt: "2026-09-07T00:00:00.000Z",
                },
              ],
            }
          : { success: true };
    await route.fulfill({
      status: 200,
      headers,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}
