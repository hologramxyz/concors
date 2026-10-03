import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { DaemonMessage, TerminalOperation, WorkspaceOperation } from "@concors/protocol";

// This check has no runtime npm dependencies. It also runs using the Node shipped in the tarball.
const args = process.argv.slice(2);
const release = args.includes("--release");
// Runs a release where it lies instead of from a relocated copy. An AppImage runs the daemon from
// a read-only mount, so pointing this at one proves nothing in the bundle writes beside itself.
const inPlace = args.includes("--in-place");
if (inPlace && !release) throw new Error("--in-place applies to --release bundles only.");
const source = resolve(args.find((arg) => !arg.startsWith("--")) ?? "dist");
const temporary = await mkdtemp(join(tmpdir(), "concors-bundle-"));
const isolated = inPlace ? source : join(temporary, "relocated bundle with spaces");
if (!inPlace) await mkdir(isolated);
let child: ReturnType<typeof spawn> | undefined;
let socket: WebSocket | undefined;
let exited: Promise<unknown> | undefined;
try {
  // In place, there is nothing to copy: the checks below read and run `source` itself.
  if (release) {
    if (!inPlace) await cp(source, isolated, { recursive: true });
  } else {
    for (const file of ["cli.js", "package.json", "node_modules"])
      await cp(join(source, file), join(isolated, file), { recursive: true });
  }
  const lib = release ? join(isolated, "lib") : isolated;
  async function checkManifests(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await checkManifests(path);
      else if (entry.name === "package.json")
        assert.ok(!(await readFile(path, "utf8")).includes("workspace:"), path);
    }
  }
  await checkManifests(isolated);
  assert.ok(!(await readFile(join(lib, "cli.js"), "utf8")).includes("workspace:*"));
  const manifest = JSON.parse(await readFile(join(lib, "package.json"), "utf8")) as {
    version: string;
  };
  const command = release ? join(isolated, "bin", "concors-daemon") : process.execPath;
  const args = release ? [] : [join(lib, "cli.js")];
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CONCORS_DATA_DIR: join(temporary, "data"),
  };
  delete environment["NODE_PATH"];
  delete environment["CONCORS_DAEMON_MANAGED_CONFIG"];
  assert.equal(
    execFileSync(command, [...args, "--version"], {
      env: environment,
      cwd: temporary,
      encoding: "utf8",
    }).trim(),
    manifest.version,
  );
  // Dictation's native addon must load with the shipped Node on the target system (glibc, rpath).
  assert.equal(
    execFileSync(
      release ? join(isolated, "bin", "node") : process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { createRequire } from "node:module";
         const sherpa = createRequire(${JSON.stringify(join(lib, "cli.js"))})("sherpa-onnx-node");
         process.stdout.write(typeof sherpa.OfflineRecognizer.createAsync);`,
      ],
      { env: environment, cwd: temporary, encoding: "utf8" },
    ),
    "function",
  );

  child = spawn(command, [...args, "serve", "--ephemeral", "--port", "0"], {
    env: environment,
    cwd: temporary,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  child.stderr?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  exited = new Promise((resolve, reject) => {
    child?.once("exit", resolve);
    child?.once("error", reject);
  });
  // Attach a handler immediately so spawn failures are reported by the readiness check.
  void exited.catch(() => undefined);
  async function waitFor<T>(probe: () => T | undefined): Promise<T> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const result = probe();
      if (result !== undefined) return result;
      if (child?.exitCode !== null || child?.signalCode !== null)
        throw new Error(`Daemon exited: ${output}`);
      await delay(25);
    }
    throw new Error(`Bundle smoke test timed out: ${output}`);
  }
  const url = await waitFor(() => /ready at (http:\/\/\S+)/.exec(output)?.[1]);
  assert.equal((await fetch(`${url}/health`)).status, 200);
  socket = new WebSocket(`${url.replace("http:", "ws:")}/ws`);
  const messages: DaemonMessage[] = [];
  socket.addEventListener("message", (event) => {
    messages.push(JSON.parse(String(event.data)) as DaemonMessage);
  });
  await new Promise<void>((resolve, reject) => {
    socket?.addEventListener("open", () => resolve());
    socket?.addEventListener("error", () => reject(new Error("WebSocket failed")));
  });
  const send = (message: unknown) => socket?.send(JSON.stringify(message));
  send({
    type: "client.hello",
    protocolVersion: "v1",
    client: { kind: "test", name: "packaged-daemon", version: "0.0.0" },
  });
  await waitFor(() => messages.find((message) => message.type === "daemon.ready"));
  send({ type: "workspace.subscribe" });
  const snapshot = await waitFor(() =>
    messages.find((message) => message.type === "workspace.snapshot"),
  );
  assert.equal(snapshot.type, "workspace.snapshot");
  const epoch = snapshot.snapshot.epoch;
  async function edit(operation: WorkspaceOperation): Promise<void> {
    const commandId = randomUUID();
    send({ type: "workspace.command", commandId, epoch, operation });
    const result = await waitFor(() =>
      messages.find(
        (message) => message.type === "workspace.result" && message.commandId === commandId,
      ),
    );
    assert.equal(result.type, "workspace.result");
    assert.equal(result.outcome.status, "accepted", JSON.stringify(result));
  }
  async function terminal(operation: TerminalOperation) {
    const requestId = randomUUID();
    send({ type: "terminal.request", requestId, operation });
    const result = await waitFor(() =>
      messages.find(
        (message) => message.type === "terminal.result" && message.requestId === requestId,
      ),
    );
    assert.equal(result.type, "terminal.result");
    assert.equal(result.outcome.status, "ok", JSON.stringify(result));
    return result.outcome.sessions;
  }
  const projectId = randomUUID(),
    tabId = randomUUID(),
    paneId = randomUUID();
  await edit({ kind: "project.add", projectId, name: "Package smoke", directory: temporary });
  await edit({
    kind: "tab.create",
    projectId,
    tabId,
    paneId,
    expectedVersion: 0,
    name: "Shell",
    profile: "shell",
  });
  const [session] = await terminal({
    kind: "start",
    epoch,
    projectId,
    tabId,
    paneId,
    expectedVersion: 1,
    expectedSessionId: null,
    cols: 80,
    rows: 24,
  });
  assert.ok(session);
  assert.equal(session.status, "running", session.error ?? undefined);
  await terminal({ kind: "attach", sessionId: session.id });
  await terminal({ kind: "claim", sessionId: session.id, cols: 90, rows: 30 });
  // Split the expected marker so echoed input alone cannot satisfy the assertion. A Windows
  // terminal opens PowerShell, which every Windows ships (see defaultShell in profiles.ts); this
  // file runs on its own in the release check, so it cannot import that.
  const input =
    process.platform === "win32"
      ? '$env:D2_MARKER = "PTY"\recho "CONCORS_$($env:D2_MARKER)_OK"\r'
      : "printf 'CONCORS_%s_OK\\n' PTY\r";
  send({ type: "terminal.input", sessionId: session.id, data: input });
  await waitFor(() =>
    messages
      .filter((message) => message.type === "terminal.output")
      .map((message) => message.data)
      .join("")
      .includes("CONCORS_PTY_OK")
      ? true
      : undefined,
  );
  await terminal({ kind: "stop", sessionId: session.id });
  process.stdout.write(
    `Isolated bundle ${manifest.version}: version, speech addon, health, workspace, PTY input/output/resize/stop passed (${process.platform}-${process.arch})\n`,
  );
} finally {
  socket?.close();
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  if (exited) await exited;
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
