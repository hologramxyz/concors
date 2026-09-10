import { copyFileSync } from "node:fs";
import { delimiter } from "node:path";
import {
  installTestCodexProfile,
  installTestClaudeProfile,
} from "../../packages/daemon/src/terminal/testing/profile.ts";
// Test-only server entry point. Production CLI never imports or enables this provider.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createDaemonServer } from "../../packages/daemon/src/server.ts";
import { loadDaemonConfig } from "../../packages/daemon/src/config.ts";
import { TestAgentProvider } from "../../packages/daemon/src/agents/testing/provider.ts";
const directory = process.env["CONCORS_DATA_DIR"];
if (!directory) throw new Error("Set an isolated acceptance-test directory");
await mkdir(directory, { recursive: true });
process.env["PATH"] = installTestCodexProfile(directory) + delimiter + (process.env["PATH"] ?? "");
installTestClaudeProfile(directory);
for (const provider of ["opencode", "pi"]) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  copyFileSync(
    join(directory, "test-bin", "codex" + suffix),
    join(directory, "test-bin", provider + suffix),
  );
}
// Keep shell startup files from replacing the harmless test executable in PATH.
if (process.platform !== "win32") process.env["SHELL"] = "/bin/sh";
const port = Number(process.env["CONCORS_E2E_DAEMON_PORT"] ?? 7429);
if (![7429, 7430].includes(port)) throw new Error("Invalid fixture daemon port");
const server = createDaemonServer(loadDaemonConfig({ port, logLevel: "warn" }, {}), {
  workspacePath: join(directory, "workspace.sqlite"),
  agentProviderFactory: (_cwd, handler, provider) => new TestAgentProvider(handler, provider),
});
// Test-only origin adaptation for a second local checkout. Production retains its
// fixed allowlist; only this exact localhost acceptance origin is adapted here.
const uiOrigin = process.env["CONCORS_E2E_UI_ORIGIN"];
if (uiOrigin && new URL(uiOrigin).hostname === "localhost") {
  server.app.addHook("onRequest", async (request) => {
    if (request.headers.origin === uiOrigin) request.headers.origin = "http://localhost:1420";
  });
}
await server.listen();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void server.close());
