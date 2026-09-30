import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  // One test at a time against one server, but CI splits the suite across runners
  // (heavy-tests.yml, --shard); per test rather than per file, since most tests share one file.
  fullyParallel: true,
  timeout: 60_000,
  use: {
    ...devices["Pixel 7"],
    defaultBrowserType: "chromium",
    baseURL: "http://localhost:8082",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm mobile:demo --port 8082",
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: "http://localhost:8082",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { CI: "1", EXPO_NO_TELEMETRY: "1", BROWSER: "none" },
  },
});
