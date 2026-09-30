import { TestAccountBackend } from "../../packages/daemon/src/agents/testing/account.ts";
import { copyFileSync } from "node:fs";
import { delimiter } from "node:path";
import {
  installTestCodexProfile,
  installTestClaudeProfile,
} from "../../packages/daemon/src/terminal/testing/profile.ts";
// Test-only server entry point. Production CLI never imports or enables this provider.
import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createDaemonServer } from "../../packages/daemon/src/server.ts";
import { loadDaemonConfig } from "../../packages/daemon/src/config.ts";
import { TestAgentProvider } from "../../packages/daemon/src/agents/testing/provider.ts";
import { fixtureGitHub } from "./github-pull-requests.ts";
import { enableProviders } from "./enable-providers.ts";
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
enableProviders(directory, ["pi"]);
// Keep shell startup files from replacing the harmless test executable in PATH.
if (process.platform !== "win32") process.env["SHELL"] = "/bin/sh";
const port = Number(process.env["CONCORS_E2E_DAEMON_PORT"] ?? 7429);
if (![7429, 7430].includes(port)) throw new Error("Invalid fixture daemon port");
const server = createDaemonServer(loadDaemonConfig({ port, logLevel: "warn" }, {}), {
  workspacePath: join(directory, "workspace.sqlite"),
  accountBackendFactory: (info) => new TestAccountBackend(info),
  gitHub: fixtureGitHub,
  agentProviderFactory: (cwd, handler, provider) => {
    const agent = new TestAgentProvider(handler, provider);
    agent.cwd = cwd;
    return agent;
  },
});
// Test-only origin adaptation for a second local checkout. Production retains its
// fixed allowlist; only this exact localhost acceptance origin is adapted here.
const uiOrigin = process.env["CONCORS_E2E_UI_ORIGIN"];
if (uiOrigin && new URL(uiOrigin).hostname === "localhost") {
  server.app.addHook("onRequest", async (request) => {
    if (request.headers.origin === uiOrigin) request.headers.origin = "http://localhost:1420";
  });
}
// New chats open with the provider and settings last chosen on this machine, and every spec
// shares this daemon, so one spec picking Claude Code would open the next spec's chats in it. The
// shared cleanup in `signed-in.ts` forgets those choices through this test-only route, which reaches
// the daemon's own database rather than adding a way to forget them to the production protocol.
const workspaceDatabase = new DatabaseSync(join(directory, "workspace.sqlite"));
workspaceDatabase.exec("PRAGMA busy_timeout = 5000;");
server.app.post("/e2e/forget-agent-defaults", async () => {
  workspaceDatabase.exec("DELETE FROM agent_defaults");
  return { forgotten: true };
});
await server.listen();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void server.close());
