// GitHub acceptance uses intercepted build assets and one isolated daemon. No Vite preview is started.
import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "github.spec.ts",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://localhost:15399", viewport: { width: 1360, height: 950 } },
  webServer: [
    {
      command: "node e2e/support/daemon.ts",
      url: "http://127.0.0.1:7430/health",
      env: {
        CONCORS_E2E_DAEMON_PORT: "7430",
        CONCORS_DATA_DIR: mkdtempSync(join(tmpdir(), "github-e2e-")),
        CONCORS_E2E_UI_ORIGIN: "http://localhost:15399",
      },
      reuseExistingServer: false,
    },
  ],
});
