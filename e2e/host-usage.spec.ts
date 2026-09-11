import type { WebSocketRoute } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { managedHost } from "./support/managed-host.ts";

const reading = {
  sampledAt: 1,
  cpuPercent: 94,
  cpuCount: 4,
  memory: { usedBytes: 7.5 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 },
};

test("CPU and RAM stay visible in settings and collapsed layouts, without retaining stale values", async ({
  page,
}) => {
  await signedIn(page);
  let paused = false;
  let client: WebSocketRoute | undefined;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    client = socket;
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "host.usage") {
        if (paused) return;
        message.usage = reading;
      }
      socket.send(JSON.stringify(message));
    });
  });
  await page.goto("/");
  const status = page.getByRole("group", { name: "Machine resource usage" });
  await expect(status).toContainText("This computer");
  await expect(status).toContainText("CPU 94%");
  await expect(status).toContainText("RAM 7.5 GiB / 8.0 GiB (94%)");
  await expect(status).toContainText("High usage");
  await page.clock.install();
  await status.hover();
  await page.clock.runFor(1000);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(status).not.toHaveAttribute("tabindex");
  await expect(status.locator("[title]")).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(status).toBeVisible();
  await page.keyboard.press("Control+Shift+,");
  await expect(page.getByRole("navigation", { name: "Settings" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "Shortcuts", exact: true })
    .click();
  await page.getByRole("main").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(status).toBeVisible();
  await page.screenshot({ path: "test-results/host-usage-settings.png" });
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 600, height: 850 });
  expect(await status.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/host-usage-narrow-dark.png" });
  paused = true;
  await page.clock.fastForward(11_000);
  await expect(status).toContainText("Usage stale");
  await expect(status).toContainText("CPU —");
  await expect(status).not.toContainText("94%");
  if (!client) throw new Error("No active telemetry connection");
  client.send(JSON.stringify({ type: "host.usage", usage: null }));
  await expect(status).toContainText("Usage unavailable");
  client.send(
    JSON.stringify({
      type: "host.usage",
      usage: {
        ...reading,
        cpuPercent: 12,
        memory: { usedBytes: 1024 ** 3, totalBytes: 8 * 1024 ** 3 },
      },
    }),
  );
  await expect(status).toContainText("CPU 12%");
  await expect(status).not.toContainText("High usage");
  client.close();
  await expect(status).not.toContainText("CPU 12%");
});

test("older daemons keep working without receiving unsupported telemetry requests", async ({
  page,
}) => {
  await signedIn(page);
  const requests: unknown[] = [];
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "host.subscribe") requests.push(message);
      server.send(raw);
    });
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "daemon.ready")
        message.capabilities = message.capabilities.filter((name: string) => name !== "host-usage");
      socket.send(JSON.stringify(message));
    });
  });
  await page.goto("/");
  const status = page.getByRole("group", { name: "Machine resource usage" });
  await expect(status).toContainText("Update daemon for usage");
  await expect(status).toContainText("CPU —");
  await expect(
    page.getByRole("button", { name: "Open workspace menu", exact: true }).first(),
  ).toBeEnabled();
  expect(requests).toEqual([]);
});

test("usage follows the selected machine and real daemon samples resume after a switch", async ({
  page,
}) => {
  await signedIn(page);
  await managedHost(page);
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "host.usage") message.usage = reading;
      socket.send(JSON.stringify(message));
    });
  });
  await page.goto("/");
  const status = page.getByRole("group", { name: "Machine resource usage" });
  await expect(status).toContainText("CPU 94%");
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await page.getByRole("menuitem", { name: /Second machine Online/i }).click();
  await expect(status).toContainText("Second machine");
  await expect(status).not.toContainText("7.5 GiB / 8.0 GiB");
  await expect(status).toHaveAttribute("data-usage-status", "live");
  await expect(status).toContainText(/CPU \d+%/);
  await expect(status).toContainText(/RAM .+ \/ .+ \(\d+%\)/);
  await page.screenshot({ path: "test-results/host-usage-live.png" });
});
