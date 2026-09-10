import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../..", import.meta.url));
export default defineConfig({
  testDir: "./e2e-direct",
  outputDir: "./test-results/direct",
  workers: 1,
  timeout: 120_000,
  use: {
    ...devices["iPhone 13"],
    defaultBrowserType: "chromium",
    baseURL: "http://localhost:8087",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/support/mobile-direct-daemon.ts",
      cwd,
      url: "http://127.0.0.1:7440/health",
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @concors/mobile web --clear --port 8087",
      cwd,
      url: "http://localhost:8087",
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        CI: "1",
        BROWSER: "none",
        EXPO_NO_TELEMETRY: "1",
        APP_VARIANT: "development",
        EXPO_PUBLIC_DEMO: "false",
        EXPO_PUBLIC_DEV_DAEMON_URL: "ws://localhost:7440/ws",
      },
    },
  ],
});
