// Isolated acceptance-test host. The production CLI never imports test providers or executables.
import { delimiter, join } from "node:path";
import { mkdir, copyFile } from "node:fs/promises";
import { runSessionHost } from "../session-host.ts";
import { TestAgentProvider } from "../../agents/testing/provider.ts";
import { installTestCodexProfile } from "../../terminal/testing/profile.ts";

const directory = process.env["CONCORS_DATA_DIR"];
if (!directory) throw new Error("An isolated test data directory is required");
await mkdir(directory, { recursive: true });
const bin = installTestCodexProfile(directory);
const suffix = process.platform === "win32" ? ".cmd" : "";
await copyFile(join(bin, `codex${suffix}`), join(bin, `claude${suffix}`));
process.env["PATH"] = bin + delimiter + (process.env["PATH"] ?? "");
await runSessionHost(
  directory,
  { host: "127.0.0.1", port: 0, logLevel: "silent" },
  {
    agentProviderFactory: (_cwd, onRequest) => new TestAgentProvider(onRequest),
  },
);
