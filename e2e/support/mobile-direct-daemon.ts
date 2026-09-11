// Isolated real daemon/PTY transport; only the coding provider is deterministic for CI.
// Never imports the mobile demo server and never touches a desktop workspace.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonServer } from "../../packages/daemon/src/server.ts";
import { loadDaemonConfig } from "../../packages/daemon/src/config.ts";
import { TestAccountBackend } from "../../packages/daemon/src/agents/testing/account.ts";
import { TestAgentProvider } from "../../packages/daemon/src/agents/testing/provider.ts";
const directory = await mkdtemp(join(tmpdir(), "concors-mobile-direct-daemon-"));
const server = createDaemonServer(loadDaemonConfig({ port: 7440, logLevel: "warn" }, {}), {
  workspacePath: join(directory, "workspace.sqlite"),
  accountBackendFactory: (info) => new TestAccountBackend(info),
  agentProviderFactory: (_cwd, handler) => new TestAgentProvider(handler),
});
server.app.addHook("onRequest", async (request) => {
  if (request.headers.origin === "http://localhost:8087")
    request.headers.origin = "http://localhost:1420";
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
