import type { Page } from "@playwright/test";

/** Real second daemon, discovered and authorized through a mocked control plane. */
export async function managedHost(
  page: Page,
  includeUnavailable = false,
  workspaceSnapshotDelayMs = 0,
) {
  let tokens = 0;
  await page.route("**/api/v1/machines**", async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": request.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const token = new URL(request.url()).pathname.endsWith("/token");
    const machine = {
      id: "second-machine",
      organizationId: "e2e-org",
      createdByUserId: "e2e-user",
      name: "Second machine",
      region: "US-EAST-VA",
      size: "small",
      serviceName: null,
      orderId: null,
      status: "running",
      ovhState: null,
      lastError: null,
      ipv4: null,
      ipv6: null,
      sshUser: "ubuntu",
      accessReadyAt: null,
      reinstallTaskId: null,
      monthlyPrice: null,
      paidUntil: null,
      cancelledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      hostname: "second.example",
      agentSeenAt: new Date().toISOString(),
      agentVersion: "0.2.0",
    };
    await route.fulfill({
      status: token ? 201 : 200,
      headers,
      json: token
        ? { token: `test-token-${++tokens}` }
        : new URL(request.url()).pathname.endsWith("/second-machine")
          ? { machine }
          : {
              machines: [
                machine,
                ...(includeUnavailable
                  ? [
                      {
                        ...machine,
                        id: "provisioning",
                        name: "Provisioning machine",
                        status: "provisioning",
                        hostname: null,
                      },
                      {
                        ...machine,
                        id: "offline",
                        name: "Offline machine",
                        agentSeenAt: new Date(Date.now() - 120_000).toISOString(),
                      },
                    ]
                  : []),
              ],
            },
    });
  });
  await page.routeWebSocket("wss://second.example/ws", (client) => {
    const server = new WebSocket("ws://127.0.0.1:7430/ws");
    const pending: (string | Buffer)[] = [];
    client.onMessage((message) => {
      if (server.readyState === WebSocket.OPEN) server.send(message);
      else pending.push(message);
    });
    server.addEventListener("open", () => {
      for (const message of pending) server.send(message);
    });
    server.addEventListener("message", (event) => {
      const message = String(event.data);
      const parsed = JSON.parse(message) as { type?: string };
      if (parsed.type === "workspace.snapshot" && workspaceSnapshotDelayMs)
        setTimeout(() => client.send(message), workspaceSnapshotDelayMs);
      else client.send(message);
    });
    server.addEventListener("close", () => client.close());
    client.onClose(() => server.close());
  });
  return { tokenCount: () => tokens };
}
