import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("lets the desktop app's policy play a video from memory", () => {
  // Nothing else exercises this: the browser tests run without the app's CSP.
  const config = JSON.parse(
    readFileSync(join(import.meta.dirname, "../src-tauri/tauri.conf.json"), "utf8"),
  ) as { app: { security: { csp: Record<string, string> } } };
  expect(config.app.security.csp["media-src"]).toContain("blob:");
});
