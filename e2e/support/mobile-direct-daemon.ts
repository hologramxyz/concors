// Isolated real daemon/PTY transport; only the coding provider is deterministic for CI.
// Never imports the mobile demo server and never touches a desktop workspace.
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  installTestCodexProfile,
  installTestClaudeProfile,
} from "../../packages/daemon/src/terminal/testing/profile.ts";
import { createDaemonServer } from "../../packages/daemon/src/server.ts";
import { loadDaemonConfig } from "../../packages/daemon/src/config.ts";
import { TestAccountBackend } from "../../packages/daemon/src/agents/testing/account.ts";
import { TestAgentProvider } from "../../packages/daemon/src/agents/testing/provider.ts";
import { mobileDirectPort, mobileWebOrigin } from "./mobile-direct-ports.cjs";
const directory = await mkdtemp(join(tmpdir(), "concors-mobile-direct-daemon-"));
// Provider discovery must find harmless fixture executables, never a developer's AI CLI.
process.env["PATH"] = installTestCodexProfile(directory) + delimiter + (process.env["PATH"] ?? "");
installTestClaudeProfile(directory);
for (const provider of ["opencode", "pi"]) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  await copyFile(
    join(directory, "test-bin", "codex" + suffix),
    join(directory, "test-bin", provider + suffix),
  );
}
if (process.platform !== "win32") process.env["SHELL"] = "/bin/sh";
const server = createDaemonServer(
  loadDaemonConfig({ port: mobileDirectPort, logLevel: "warn" }, {}),
  {
    workspacePath: join(directory, "workspace.sqlite"),
    agentProviderFactory: (_cwd, handler, provider) => new TestAgentProvider(handler, provider),
    accountBackendFactory: (info) => new TestAccountBackend(info),
  },
);
server.app.addHook("onRequest", async (request) => {
  if (request.headers.origin === mobileWebOrigin) request.headers.origin = "http://localhost:1420";
});
await server.listen();
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    if (closing) return;
    closing = true;
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
