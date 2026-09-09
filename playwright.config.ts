import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Temporary state isolates acceptance tests from real local projects and sessions.
const dataDir = mkdtempSync(join(tmpdir(), "concors-e2e-"));
const port = Number(process.env["CONCORS_E2E_WEB_PORT"] ?? 1420);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid E2E web port");
const baseURL = `http://localhost:${port}`;
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL,
    viewport: { width: 1360, height: 850 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/support/daemon.ts",
      url: "http://127.0.0.1:7429/health",
      env: { CONCORS_DATA_DIR: join(dataDir, "first"), CONCORS_E2E_UI_ORIGIN: baseURL },
      reuseExistingServer: false,
    },
    {
      command: "node e2e/support/daemon.ts",
      url: "http://127.0.0.1:7430/health",
      env: {
        CONCORS_DATA_DIR: join(dataDir, "second"),
        CONCORS_E2E_UI_ORIGIN: baseURL,
        CONCORS_E2E_DAEMON_PORT: "7430",
      },
      reuseExistingServer: false,
    },
    {
      command: `pnpm desktop:web:dev --port ${port}`,
      url: baseURL,
      env: { VITE_CONCORS_DAEMON_URL: "ws://127.0.0.1:7429/ws" },
      reuseExistingServer: false,
    },
  ],
});
