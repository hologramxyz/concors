// Test-only server entry point. Production CLI never imports or enables this provider.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createDaemonServer } from "../../packages/daemon/src/server.ts";
import { loadDaemonConfig } from "../../packages/daemon/src/config.ts";
import { TestAgentProvider } from "../../packages/daemon/src/agents/testing/provider.ts";
const directory = process.env["CONCORS_DATA_DIR"];
if (!directory) throw new Error("Set an isolated acceptance-test directory");
await mkdir(directory, { recursive: true });
const server = createDaemonServer(loadDaemonConfig({ port: 7429, logLevel: "warn" }, {}), {
  workspacePath: join(directory, "workspace.sqlite"),
  agentProviderFactory: (_cwd, handler) => new TestAgentProvider(handler),
});
await server.listen();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void server.close());
