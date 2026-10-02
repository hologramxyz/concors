import { test as base, expect, type Page } from "@playwright/test";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";

// Specs share isolated daemons. Clear previous projects as well as live PTYs so a failed
// test cannot leave agent panes in the next test's sidebar, and forget the agent provider and
// settings remembered for new chats so each spec's first chat opens in Codex.
export const test = base.extend({
  page: async ({ page }, use) => {
    for (const port of [7429, 7430]) {
      const forgotten = await fetch(`http://127.0.0.1:${port}/e2e/forget-agent-defaults`, {
        method: "POST",
      });
      expect(forgotten.ok).toBe(true);
      const connection = new DaemonConnection({
        endpoint: describeDaemonEndpoint(`ws://127.0.0.1:${port}/ws`),
        client: { kind: "test", name: "workspace cleanup", version: "0.0.0" },
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
        const workspace = connection.workspace;
        if (!workspace) throw new Error("Workspace disconnected during cleanup");
        for (const project of workspace.projects) {
          const removed = await connection.executeWorkspace({
            type: "workspace.command",
            commandId: crypto.randomUUID(),
            epoch: workspace.epoch,
            operation: {
              kind: "project.remove",
              projectId: project.id,
              expectedVersion: project.version,
            },
          });
          expect(removed.outcome.status).toBe("accepted");
        }
      } finally {
        unsubscribe();
        connection.disconnect();
      }
    }
    await use(page);
  },
});
export { expect };

const TOKEN_KEY = "concors.auth.session-token.v1";

interface FakeSubscription {
  id: string;
  engine: "claude" | "codex";
  nickname: string;
  accountNickname: string | null;
  accountLabel: string | null;
  createdAt: string;
  updatedAt: string;
}
/**
 * The control plane's subscription library for one signed-in person. Pass the same one to two
 * pages to play two computers signed in to the same account.
 */
export class SubscriptionLibrary {
  readonly rows: FakeSubscription[] = [];
  readonly removed = new Set<string>();
  /** The library as the API lists it. */
  get active() {
    return this.rows.filter((row) => !this.removed.has(row.id));
  }
  save(id: string, body: Partial<FakeSubscription>): FakeSubscription | null {
    if (this.removed.has(id)) return null;
    const now = new Date().toISOString();
    const existing = this.rows.find((row) => row.id === id);
    const fields = Object.fromEntries(
      (["nickname", "accountNickname", "accountLabel"] as const).flatMap((key) =>
        body[key] === undefined ? [] : [[key, body[key]]],
      ),
    );
    if (existing) {
      Object.assign(existing, fields, { updatedAt: now });
      return existing;
    }
    const row: FakeSubscription = {
      id,
      engine: body.engine ?? "claude",
      nickname: body.nickname ?? "Account",
      accountNickname: null,
      accountLabel: null,
      ...fields,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }
}

async function subscriptionsApi(
  library: SubscriptionLibrary,
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json?: unknown }> {
  const id = decodeURIComponent(path.split("/")[4] ?? "");
  if (method === "GET") return { status: 200, json: { subscriptions: library.active } };
  if (method === "POST" && id === "import") {
    for (const row of (body as { subscriptions: Partial<FakeSubscription>[] }).subscriptions)
      if (row.id && !library.rows.some((existing) => existing.id === row.id))
        library.save(row.id, row);
    return { status: 200, json: { subscriptions: library.active } };
  }
  if (method === "PUT") {
    const saved = library.save(id, body as Partial<FakeSubscription>);
    return saved
      ? { status: 200, json: { subscription: saved } }
      : { status: 404, json: { statusCode: 404, error: "Not Found", message: "Removed" } };
  }
  if (method === "DELETE" && library.active.some((row) => row.id === id)) {
    library.removed.add(id);
    return { status: 204 };
  }
  return { status: 404, json: { statusCode: 404, error: "Not Found", message: "Not found" } };
}

/**
 * The app renders nothing but the sign-in screen until the control plane confirms a session. Specs
 * that are about the workspace, not about auth, call this before `goto`: it preloads a saved token
 * and answers the API as an already-signed-in user, at the network layer. `auth.spec.ts` covers the
 * sign-in gate itself.
 */
export async function signedIn(
  page: Page,
  name = "E2E User",
  subscriptions = new SubscriptionLibrary(),
): Promise<void> {
  await page.addInitScript(
    ([key, token]: [string, string]) => {
      // Mobile's sandboxed renderer has no storage access and must never receive account tokens.
      if (window === window.top) localStorage.setItem(key, token);
    },
    [TOKEN_KEY, "e2e-session-token"] as [string, string],
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const origin = request.headers()["origin"] ?? "*";
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/subscriptions")) {
      const result = await subscriptionsApi(
        subscriptions,
        request.method(),
        path,
        request.postDataJSON(),
      );
      return route.fulfill({
        status: result.status,
        headers,
        ...(result.json === undefined ? {} : { json: result.json }),
      });
    }
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
