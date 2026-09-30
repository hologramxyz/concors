import { test, expect, signedIn } from "./signed-in.ts";
import { managedHost } from "./support/managed-host.ts";

/** The app's entry script: the source module from a dev server, the hashed bundle from a build. */
const ENTRY = /\/(src\/main\.tsx|assets\/index-[\w-]+\.js)(\?.*)?$/;

function gate() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Hold each real startup boundary independently so an intermediate page cannot hide in a fast run.
test("one branded splash stays mounted through auth, saved machine restoration and the first snapshot", async ({
  page,
}) => {
  const auth = gate(),
    machine = gate(),
    snapshot = gate();
  let authRequested = false,
    machineRequested = false,
    snapshotReceived = false;
  await signedIn(page);
  await managedHost(page);
  await page.addInitScript(() =>
    localStorage.setItem("concors.selected-machine.v1:e2e-user:e2e-org", "second-machine"),
  );
  await page.route("**/api/v1/me", async (route) => {
    authRequested = true;
    await auth.promise;
    await route.fallback();
  });
  await page.route("**/api/v1/machines?**", async (route) => {
    machineRequested = true;
    await machine.promise;
    await route.fallback();
  });
  const connections: string[] = [];
  page.on("websocket", (socket) => connections.push(socket.url()));
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
      const data = String(event.data);
      if (JSON.parse(data).type === "workspace.snapshot") {
        snapshotReceived = true;
        void snapshot.promise.then(() => client.send(data));
      } else client.send(data);
    });
    server.addEventListener("close", () => client.close());
    client.onClose(() => server.close());
  });
  await page.goto("/");
  await expect.poll(() => authRequested).toBe(true);
  const splash = page.getByRole("status", { name: "Opening Concors", exact: true });
  await expect(splash).toBeVisible();
  const original = await splash.elementHandle();
  const quiet = async () => {
    await expect(splash).toBeVisible();
    expect(
      await original?.evaluate((node) => node === document.querySelector("[data-startup-screen]")),
    ).toBe(true);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(
      page.getByText(/Restoring your session|Connect to your workspace|Sign in to Concors/),
    ).toHaveCount(0);
  };
  await quiet();
  auth.release();
  await expect.poll(() => machineRequested).toBe(true);
  await quiet();
  expect(connections.some((url) => url.includes(":7429/ws"))).toBe(false);
  machine.release();
  await expect.poll(() => snapshotReceived).toBe(true);
  await quiet();
  await page.screenshot({ path: test.info().outputPath("startup-splash.png") });
  snapshot.release();
  await expect(page.getByRole("button", { name: "Switch machine", exact: true })).toContainText(
    "Second machine",
  );
  await expect(splash).toHaveCount(0);
  expect(connections.some((url) => url.includes(":7429/ws"))).toBe(false);
});

test("the first HTML paint already has the mark and saved dark appearance before React downloads", async ({
  page,
}) => {
  const entry = gate();
  await signedIn(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("concors.theme", "dark"));
  await page.route(ENTRY, async (route) => {
    await entry.promise;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  const splash = page.getByRole("status", { name: "Opening Concors", exact: true });
  await expect(splash).toBeVisible();
  await expect(splash).toHaveCSS("background-color", "rgb(17, 17, 17)");
  expect(await splash.locator("path").getAttribute("d")).toMatch(/^M12 24L48/);
  const shimmer = splash.locator(".concors-startup-shimmer");
  expect(await shimmer.evaluate((node) => getComputedStyle(node, "::after").animationName)).toBe(
    "none",
  );
  await page.screenshot({ path: test.info().outputPath("startup-first-paint-dark.png") });
  entry.release();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(splash).toHaveCount(0);
});

test("custom appearance survives the first frame of a reload", async ({ page }) => {
  await signedIn(page);
  await page.addInitScript(() => {
    localStorage.setItem("concors.theme", "dark");
    localStorage.setItem("concors.color-theme", JSON.stringify({ id: "ocean" }));
  });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  const cached = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("concors.startup-appearance.v1") ?? "null"),
  );
  expect(cached.id).toBe("ocean");
  const entry = gate();
  await page.route(ENTRY, async (route) => {
    await entry.promise;
    await route.continue();
  });
  await page.reload({ waitUntil: "commit" });
  const splash = page.getByRole("status", { name: "Opening Concors", exact: true });
  await expect(splash).toBeVisible();
  expect(
    await splash.evaluate((node) =>
      getComputedStyle(node).getPropertyValue("--startup-background").trim(),
    ),
  ).toBe(cached.background);
  entry.release();
  await expect(splash).toHaveCount(0);
});

test("a slow connection offers recovery without cycling through placeholder pages", async ({
  page,
}) => {
  await signedIn(page);
  await page.clock.install();
  await page.routeWebSocket("**/ws", () => {
    /* Hold the daemon handshake. */
  });
  await page.goto("/");
  const splash = page.getByRole("status", { name: "Opening Concors", exact: true });
  await expect(splash).toBeVisible();
  await expect(page.getByRole("button", { name: "Connection settings", exact: true })).toHaveCount(
    0,
  );
  await page.clock.fastForward(12_500);
  await expect(splash.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await splash.getByRole("button", { name: "Connection settings", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Machines", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(splash).toHaveCount(0);
});

test("a removed saved machine resolves directly to this computer", async ({ page }) => {
  await signedIn(page);
  await managedHost(page);
  await page.addInitScript(() =>
    localStorage.setItem("concors.selected-machine.v1:e2e-user:e2e-org", "removed-machine"),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Switch machine", exact: true })).toContainText(
    "This computer",
  );
  await expect(page.locator("[data-startup-screen]")).toHaveCount(0);
});

test("an established workspace remains visible during reconnection", async ({ page }) => {
  await signedIn(page);
  let disconnect: () => void = () => undefined;
  await page.routeWebSocket("**/ws", (client) => {
    const server = client.connectToServer();
    disconnect = () => server.close({ code: 1001, reason: "Test reconnect" });
  });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  disconnect();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.locator("[data-startup-screen]")).toHaveCount(0);
  await expect(page.getByText("Start working on this machine", { exact: true })).toBeVisible();
});

test("a lasting drop shows a quiet reconnecting notice instead of clearing the workspace", async ({
  page,
}) => {
  await signedIn(page);
  let refuse = false;
  let disconnect: () => void = () => undefined;
  await page.routeWebSocket("**/ws", (client) => {
    if (refuse) {
      client.close({ code: 1011, reason: "Unavailable" });
      return;
    }
    client.connectToServer();
    disconnect = () => client.close({ code: 1001, reason: "Test reconnect" });
  });
  await page.goto("/");
  const notice = page.getByRole("status").filter({ hasText: "Reconnecting to" });
  await expect(page.getByText("Start working on this machine", { exact: true })).toBeVisible();
  refuse = true;
  disconnect();
  await expect(notice).toBeVisible();
  await expect(page.getByText("Start working on this machine", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  refuse = false;
  await notice.getByRole("button", { name: "Retry now" }).click();
  await expect(notice).toHaveCount(0);
});

test("direct settings links can open without waiting for a workspace connection", async ({
  page,
}) => {
  await signedIn(page);
  await page.routeWebSocket("**/ws", () => {
    /* Settings do not require a working daemon. */
  });
  await page.goto("/settings/billing");
  await expect(page.getByRole("navigation", { name: "Settings" })).toBeVisible();
  await expect(page.locator("[data-startup-screen]")).toHaveCount(0);
});
