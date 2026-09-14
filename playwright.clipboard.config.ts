import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Built assets are intercepted by the spec; this does not start a Vite preview.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "terminal-clipboard.spec.ts",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://localhost:15396",
    viewport: { width: 1200, height: 800 },
    permissions: ["local-network-access", "clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: "node e2e/support/daemon.ts",
    url: "http://127.0.0.1:7430/health",
    env: {
      CONCORS_E2E_DAEMON_PORT: "7430",
      CONCORS_DATA_DIR: mkdtempSync(join(tmpdir(), "clipboard-e2e-")),
      CONCORS_E2E_UI_ORIGIN: "http://localhost:15396",
    },
    reuseExistingServer: false,
  },
});
