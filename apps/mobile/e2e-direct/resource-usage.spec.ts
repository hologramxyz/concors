import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { mobileDirectSocket } from "../../../e2e/support/mobile-direct-ports.cjs";

async function connect(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await expect(ui.getByRole("button", { name: "Open sidebar", exact: true })).toBeVisible();
  return ui;
}

test("live CPU and RAM fit below the mobile machine selector and unsubscribe when the sidebar closes", async ({
  page,
}) => {
  const subscriptions: boolean[] = [];
  let sockets = 0;
  await page.routeWebSocket(mobileDirectSocket, (socket) => {
    sockets++;
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "host.subscribe") subscriptions.push(message.enabled);
      server.send(raw);
    });
  });
  const ui = await connect(page);
  const usage = ui.getByRole("group", { name: "Machine resource usage", exact: true });
  await expect(usage).toHaveCount(0);
  expect(subscriptions).toEqual([]);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(usage).toHaveAttribute("data-usage-status", "live");
  await expect(usage).toContainText(/CPU \d+%/);
  await expect(usage).toContainText(/RAM .+ \/ .+/);
  const sidebar = ui.locator("#mobile-sidebar");
  await expect(
    sidebar.getByRole("button", { name: "Account: Your profile", exact: true }),
  ).toBeVisible();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 700 });
    expect(await usage.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const pickerBox = await sidebar
      .getByRole("combobox", { name: "Machine", exact: true })
      .boundingBox();
    const usageBox = await usage.boundingBox();
    if (!pickerBox || !usageBox) throw new Error("Machine picker or usage is missing");
    expect(usageBox.y).toBeGreaterThanOrEqual(pickerBox.y + pickerBox.height);
    expect(usageBox.height).toBeLessThanOrEqual(40);
  }
  await page.screenshot({
    path: "apps/mobile/test-results/direct/mobile-sidebar-usage.png",
    animations: "disabled",
  });
  await ui.getByRole("button", { name: "Return to workspace", exact: true }).click();
  await expect(usage).toHaveCount(0);
  await expect.poll(() => subscriptions).toEqual([true, false]);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(usage).toHaveAttribute("data-usage-status", "live");
  await expect.poll(() => subscriptions).toEqual([true, false, true]);
  expect(sockets).toBe(1);
});

test("mobile usage clears stale, unavailable and disconnected readings while retaining high-usage warnings", async ({
  page,
}) => {
  let paused = false;
  let client: WebSocketRoute | undefined;
  const reading = {
    sampledAt: 1,
    cpuPercent: 94,
    cpuCount: 4,
    memory: { usedBytes: 7.5 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 },
  };
  await page.routeWebSocket(mobileDirectSocket, (socket) => {
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
  const ui = await connect(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const usage = ui.getByRole("group", { name: "Machine resource usage", exact: true });
  await expect(usage).toContainText("CPU 94%");
  await expect(usage).toContainText("RAM 7.5 GiB / 8.0 GiB");
  await expect(usage).toContainText("High usage");
  await page.clock.install();
  paused = true;
  await page.clock.fastForward(11_000);
  await expect(usage).toContainText("Usage stale");
  await expect(usage).toContainText("CPU —");
  await expect(usage).not.toContainText("94%");
  if (!client) throw new Error("Telemetry socket is missing");
  client.send(JSON.stringify({ type: "host.usage", usage: null }));
  await expect(usage).toContainText("Usage unavailable");
  client.send(
    JSON.stringify({
      type: "host.usage",
      usage: { ...reading, cpuPercent: 12, memory: { ...reading.memory, usedBytes: 1024 ** 3 } },
    }),
  );
  await expect(usage).toContainText("CPU 12%");
  await expect(usage).not.toContainText("High usage");
  client.close();
  await expect(usage).not.toContainText("CPU 12%");
});

test("repeated unavailable samples cannot keep mobile telemetry checking forever", async ({
  page,
}) => {
  let client: WebSocketRoute | undefined;
  await page.routeWebSocket(mobileDirectSocket, (socket) => {
    client = socket;
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "host.usage") socket.send(raw);
    });
  });
  const ui = await connect(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const usage = ui.getByRole("group", { name: "Machine resource usage", exact: true });
  await expect(usage).toContainText("Checking usage…");
  await page.clock.install();
  if (!client) throw new Error("Telemetry socket is missing");
  const unavailable = JSON.stringify({ type: "host.usage", usage: null });
  client.send(unavailable);
  await page.clock.runFor(6000);
  client.send(unavailable);
  await expect(usage).toContainText("Checking usage…");
  await page.clock.runFor(6000);
  await expect(usage).toContainText("Usage unavailable");
  client.send(unavailable);
  await page.clock.runFor(1000);
  await expect(usage).toContainText("Usage unavailable");
});

test("older mobile daemons keep working without unsupported resource subscriptions", async ({
  page,
}) => {
  const subscriptions: unknown[] = [];
  await page.routeWebSocket(mobileDirectSocket, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "host.subscribe") subscriptions.push(message);
      server.send(raw);
    });
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "daemon.ready")
        message.capabilities = message.capabilities.filter((name: string) => name !== "host-usage");
      socket.send(JSON.stringify(message));
    });
  });
  const ui = await connect(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(
    ui.getByRole("group", { name: "Machine resource usage", exact: true }),
  ).toContainText("Update daemon for usage");
  await expect(ui.getByRole("combobox", { name: "Machine", exact: true })).toBeEnabled();
  expect(subscriptions).toEqual([]);
});
