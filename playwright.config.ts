import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Temporary state isolates acceptance tests from real local projects and sessions.
const dataDir = mkdtempSync(join(tmpdir(), "concors-e2e-"));
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1360, height: 850 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/support/daemon.ts",
      url: "http://127.0.0.1:7429/health",
      env: { CONCORS_DATA_DIR: join(dataDir, "first") },
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @concors/daemon exec node src/cli.ts serve --port 7430 --log-level warn",
      url: "http://127.0.0.1:7430/health",
      env: { CONCORS_DATA_DIR: join(dataDir, "second") },
      reuseExistingServer: false,
    },
    {
      command: "pnpm desktop:web:dev",
      url: "http://localhost:1420",
      env: { VITE_CONCORS_DAEMON_URL: "ws://127.0.0.1:7429/ws" },
      reuseExistingServer: false,
    },
  ],
});
