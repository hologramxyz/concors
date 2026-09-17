import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
// Reuse the isolated desktop fixture servers, always away from a running desktop's ports.
process.env["CONCORS_E2E_WEB_PORT"] ??= "15432";
const { default: desktop } = await import("../../playwright.config.ts");
export default defineConfig({
  ...desktop,
  testDir: "./e2e-managed",
  outputDir: "./test-results/managed",
  timeout: 90_000,
  webServer: [
    ...(Array.isArray(desktop.webServer) ? desktop.webServer : []).map((server) => ({
      ...server,
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
    })),
    {
      command: "pnpm --filter @concors/mobile web --port 8088",
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      url: "http://localhost:8088",
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        CI: "1",
        BROWSER: "none",
        EXPO_NO_TELEMETRY: "1",
        EXPO_NO_DOTENV: "1",
        APP_VARIANT: "development",
        EXPO_PUBLIC_DEMO: "false",
        EXPO_PUBLIC_DEV_DAEMON_URL: "",
        EXPO_PUBLIC_API_URL: "https://control-plane.example",
      },
    },
  ],
});
