import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { signedIn } from "./signed-in.ts";
import { openFolder } from "./support/projects.ts";

test.beforeEach(async ({ page, baseURL }) => {
  if (baseURL !== "http://localhost:15397") return;
  await page.route("http://localhost:15397/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/")) return route.fallback();
    const file = path.startsWith("/assets/") ? path.slice(1) : "index.html";
    const types: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".woff2": "font/woff2",
    };
    await route.fulfill({
      body: await readFile(resolve("apps/desktop/dist", file)),
      contentType: types[extname(file)] ?? "application/octet-stream",
    });
  });
});

async function native(page: Page, port: number, decorated = false) {
  await page.addInitScript(
    ({ port, decorated }) => {
      let maximized = false;
      let sequence = 0;
      const callbacks = new Map<number, (event: unknown) => void>();
      const listeners = new Map<number, { event: string; handler: number }>();
      const calls: string[] = [];
      const host = window as unknown as Record<string, unknown>;
      host["isTauri"] = true;
      host["windowCalls"] = calls;
      host["__TAURI_EVENT_PLUGIN_INTERNALS__"] = {
        unregisterListener: (_event: string, id: number) => listeners.delete(id),
      };
      host["__TAURI_INTERNALS__"] = {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: (callback: (event: unknown) => void) => {
          callbacks.set(++sequence, callback);
          return sequence;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          calls.push(command);
          if (command === "start_local_daemon") return { state: "running", pid: 1, port };
          if (command === "plugin:window|is_decorated") return decorated;
          if (command === "plugin:window|is_maximized") return maximized;
          if (command === "plugin:window|is_fullscreen") return false;
          if (command === "plugin:event|listen") {
            const id = ++sequence;
            listeners.set(id, { event: String(args["event"]), handler: Number(args["handler"]) });
            return id;
          }
          if (command === "plugin:window|toggle_maximize") {
            maximized = !maximized;
            for (const [id, listener] of listeners)
              if (listener.event === "tauri://resize")
                callbacks.get(listener.handler)?.({
                  id,
                  event: listener.event,
                  payload: { width: 1200, height: 800 },
                });
          }
          return null;
        },
      };
    },
    { port, decorated },
  );
}

test("browser and decorated native windows retain their own window controls", async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 401, json: { message: "Sign in" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to Concors" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Window controls" })).toHaveCount(0);
  await native(page, 7430, true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to Concors" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Window controls" })).toHaveCount(0);
});

test("sign-in exposes native actions and updates maximize/resize state", async ({
  page,
  baseURL,
}) => {
  await native(page, baseURL === "http://localhost:15397" ? 7430 : 7429);
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 401, json: { message: "Sign in" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("group", { name: "Window controls" })).toHaveCount(1);
  await expect(page.locator("[data-window-resize]")).toHaveCount(8);
  await page.getByRole("button", { name: "Maximize window", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore window" })).toBeVisible();
  await expect(page.locator("[data-window-resize]")).toHaveCount(0);
  await page.getByRole("button", { name: "Restore window" }).click();
  await expect(page.locator("[data-window-resize]")).toHaveCount(8);
  await page.getByRole("button", { name: "Minimize window" }).click();
  await page.getByRole("button", { name: "Close window" }).click();
  const calls = await page.evaluate(
    () => (window as unknown as { windowCalls: string[] }).windowCalls,
  );
  expect(calls).toContain("plugin:window|minimize");
  expect(calls).toContain("plugin:window|close");
});

test("controls stay accessible alongside tabs and the narrow Files panel", async ({
  page,
  baseURL,
}) => {
  const folder = await mkdtemp(join(tmpdir(), "window-controls-"));
  try {
    await native(page, baseURL === "http://localhost:15397" ? 7430 : 7429);
    await signedIn(page);
    await page.goto("/");
    await expect(page.getByRole("group", { name: "Window controls" })).toHaveCount(1);
    await openFolder(page, folder);
    await expect(page.getByLabel("Project tabs")).toBeVisible();
    await page.getByRole("button", { name: "Toggle project files" }).click();
    const panel = page.getByRole("complementary", { name: "Project files" });
    await expect(panel.getByRole("group", { name: "Window controls" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Window controls" })).toHaveCount(1);
    await page.getByRole("separator", { name: "Resize files sidebar" }).press("Home");
    await page.setViewportSize({ width: 800, height: 600 });
    const closeFiles = await page
      .getByRole("button", { name: "Close files", exact: true })
      .boundingBox();
    const minimize = await page.getByRole("button", { name: "Minimize window" }).boundingBox();
    if (!closeFiles || !minimize) throw new Error("Window/file controls are missing");
    expect(closeFiles.x + closeFiles.width).toBeLessThanOrEqual(minimize.x);
    await page.getByRole("button", { name: "Close files", exact: true }).click();
    await expect(page.getByRole("group", { name: "Window controls" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Maximize window", exact: true })).toBeVisible();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
