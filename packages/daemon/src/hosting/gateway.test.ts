import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, expect, it } from "vitest";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { TerminalEvent, TerminalOperation, WorkspaceOperation } from "@concors/protocol";
import { createPersistentGateway } from "./gateway.ts";
import { ensureSessionHost, stopSessionHost } from "./session-host.ts";

const cli = fileURLToPath(new URL("../cli.ts", import.meta.url));
const config = { host: "127.0.0.1", port: 0, logLevel: "silent" } as const;
const launch = {
  executable: process.execPath,
  args: [cli, "session-host", "--log-level", "silent"],
};
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Could not clean up session test fixtures");
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "concors-host-"));
  cleanups.push(async () => {
    await stopSessionHost(directory);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return directory;
}
async function connect(url: string) {
  const c = new DaemonConnection({
    endpoint: describeDaemonEndpoint(url),
    client: { kind: "test", name: "continuity", version: "0.0.0" },
  });
  const events: TerminalEvent[] = [];
  c.subscribeWorkspace(() => undefined);
  c.onTerminal((event) => events.push(event));
  cleanups.push(async () => c.disconnect());
  await c.connect();
  await expect.poll(() => c.workspace).not.toBeNull();
  return { c, events };
}
async function edit(c: DaemonConnection, operation: WorkspaceOperation) {
  const r = await c.executeWorkspace({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: c.workspace!.epoch,
    operation,
  });
  expect(r.outcome.status).toBe("accepted");
}
async function terminal(c: DaemonConnection, operation: TerminalOperation) {
  const r = await c.requestTerminal(operation, randomUUID());
  if (r.outcome.status === "error") throw new Error(r.outcome.message);
  return r.outcome.sessions;
}
async function gateway(directory: string, hostLaunch = launch) {
  const g = createPersistentGateway(config, directory, hostLaunch);
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await g.close();
    }
  };
  cleanups.push(close);
  return { url: await g.listen(), close };
}
async function cliGateway(directory: string) {
  const child = spawn(process.execPath, [cli, "serve", "--port", "0", "--log-level", "info"], {
    env: { ...process.env, CONCORS_DATA_DIR: directory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
  });
  let output = "";
  child.stdout.on("data", (data: Buffer) => {
    output += data.toString();
  });
  await expect
    .poll(() => /ready at (http:\/\/[^\s]+)/.exec(output)?.[1], { timeout: 15000 })
    .toBeTruthy();
  return { child, exited, url: /ready at (http:\/\/[^\s]+)/.exec(output)![1]! };
}

it("preserves a real process, shell environment, cwd, screen, and bindings across graceful and killed gateways", async () => {
  const directory = await fixture();
  const cwd = join(directory, "working folder");
  await mkdir(cwd);
  const probe = join(directory, "probe.json");
  const script = join(directory, "counter.cjs");
  await writeFile(
    script,
    `const fs=require('node:fs'); let n=0; setInterval(()=>{const s={pid:process.pid,n:++n,cwd:fs.realpathSync(process.cwd()),env:process.env.CONCORS_CONTINUITY};fs.writeFileSync(${JSON.stringify(probe)},JSON.stringify(s));process.stdout.write('HOST_COUNTER:'+n+'\\r\\n')},100);`,
  );
  const first = await gateway(directory);
  const { c } = await connect(first.url);
  const projectId = randomUUID(),
    tabId = randomUUID(),
    paneId = randomUUID();
  await edit(c, { kind: "project.add", projectId, name: "Continuity", directory });
  await edit(c, {
    kind: "tab.create",
    projectId,
    tabId,
    paneId,
    expectedVersion: 0,
    name: "Shell",
    profile: "shell",
  });
  const [session] = await terminal(c, {
    kind: "start",
    epoch: c.workspace!.epoch,
    projectId,
    tabId,
    paneId,
    expectedVersion: 1,
    expectedSessionId: null,
    cols: 80,
    rows: 24,
  });
  expect(session?.status).toBe("running");
  const sessionId = session!.id;
  await terminal(c, { kind: "attach", sessionId });
  await terminal(c, { kind: "claim", sessionId, cols: 80, rows: 24 });
  const quote = (value: string) => `"${value}"`;
  const command =
    process.platform === "win32"
      ? `set CONCORS_CONTINUITY=kept\r\ncd /d ${quote(cwd)}\r\n${quote(process.execPath)} ${quote(script)}\r\n`
      : `export CONCORS_CONTINUITY=kept\rcd ${quote(cwd)}\r${quote(process.execPath)} ${quote(script)}\r`;
  c.sendTerminalInput(sessionId, command);
  const state = async (): Promise<{ pid: number; n: number; cwd: string; env: string } | null> => {
    try {
      return JSON.parse(await readFile(probe, "utf8"));
    } catch {
      return null;
    }
  };
  // Normalize both sides: macOS has /var aliases; Windows may use 8.3 TMPDIR names.
  // Compare the physical directory without weakening the working-directory assertion.
  await expect.poll(state).toMatchObject({ cwd: await realpath(cwd), env: "kept" });
  const before = (await state())!;
  const host = await ensureSessionHost(directory, launch);
  await first.close();
  await expect.poll(async () => (await state())?.n ?? 0).toBeGreaterThan(before.n + 2);
  const second = await cliGateway(directory);
  const remote = await connect(second.url);
  await terminal(remote.c, { kind: "attach", sessionId });
  await expect
    .poll(() => remote.events.findLast((event) => event.type === "terminal.snapshot"))
    .toMatchObject({
      session: { id: sessionId, status: "running" },
      data: expect.stringContaining("HOST_COUNTER:"),
    });
  expect(remote.c.workspace?.selection).toEqual({ projectId, tabId });
  expect(remote.c.workspace?.projects[0]?.tabs[0]?.nodes[0]).toMatchObject({
    id: paneId,
    sessionId,
  });
  second.child.kill("SIGKILL");
  await second.exited;
  const third = await gateway(directory);
  const reattached = await connect(third.url);
  await terminal(reattached.c, { kind: "attach", sessionId });
  await terminal(reattached.c, { kind: "claim", sessionId, cols: 90, rows: 30 });
  expect((await state())?.pid).toBe(before.pid);
  expect((await ensureSessionHost(directory, launch)).pid).toBe(host.pid);
  await expect
    .poll(() => reattached.events.findLast((event) => event.type === "terminal.snapshot"))
    .toMatchObject({
      session: { status: "running", id: sessionId },
      data: expect.stringContaining("HOST_COUNTER:"),
    });
}, 30000);

it("keeps an in-flight Agent chat turn and pending approval alive across gateway restarts", async () => {
  const directory = await fixture();
  const hostLaunch = {
    executable: process.execPath,
    args: [fileURLToPath(new URL("./testing/host.ts", import.meta.url))],
  };
  const first = await gateway(directory, hostLaunch);
  const { c } = await connect(first.url);
  const projectId = randomUUID(),
    tabId = randomUUID(),
    paneId = randomUUID();
  await edit(c, { kind: "project.add", projectId, name: "Chat", directory });
  await edit(c, {
    kind: "tab.create",
    projectId,
    tabId,
    paneId,
    expectedVersion: 0,
    name: "Agent",
    profile: "chat",
  });
  const started = await c.requestAgent(
    { kind: "start", epoch: c.workspace!.epoch, projectId, tabId, paneId, expectedVersion: 1 },
    randomUUID(),
  );
  expect(started.outcome.status).toBe("ok");
  await expect.poll(() => c.agents[0]?.status).toBe("idle");
  const id = c.agents[0]!.id;
  await c.requestAgent({ kind: "send", sessionId: id, text: "hold the stream" }, randomUUID());
  await expect.poll(() => c.agents[0]?.status).toBe("working");
  const turnId = c.agents[0]!.turnId!;
  await first.close();
  const second = await gateway(directory, hostLaunch);
  const remote = await connect(second.url);
  await expect.poll(() => remote.c.agents[0]).toMatchObject({ id, turnId, status: "working" });
  await remote.c.requestAgent({ kind: "interrupt", sessionId: id, turnId }, randomUUID());
  await remote.c.requestAgent({ kind: "send", sessionId: id, text: "approve this" }, randomUUID());
  await expect.poll(() => remote.c.agents[0]?.status).toBe("needs_input");
  const pendingId = remote.c.agents[0]!.pending[0]!.id;
  await second.close();
  const third = await gateway(directory, hostLaunch);
  const recovered = await connect(third.url);
  await expect.poll(() => recovered.c.agents[0]?.pending[0]?.id).toBe(pendingId);
  const response = await recovered.c.requestAgent(
    { kind: "respond", sessionId: id, pendingId, decision: "accept" },
    randomUUID(),
  );
  expect(response.outcome.status).toBe("ok");
  await expect.poll(() => recovered.c.agents[0]?.status).toBe("done");
}, 30000);

it("starts one host for simultaneous gateways and protects the private endpoint", async () => {
  const directory = await fixture();
  const [a, b] = await Promise.all([gateway(directory), gateway(directory)]);
  const host = await ensureSessionHost(directory, launch);
  expect((await fetch(`http://127.0.0.1:${host.port}/health`)).status).toBe(401);
  expect((await fetch(`${a.url}/internal/stop`, { method: "POST" })).status).toBe(404);
  const first = await connect(a.url),
    second = await connect(b.url);
  await edit(first.c, {
    kind: "project.add",
    projectId: randomUUID(),
    name: "Same host",
    directory,
  });
  await expect.poll(() => second.c.workspace?.projects.length).toBe(1);
  expect((await ensureSessionHost(directory, launch)).pid).toBe(host.pid);
}, 30000);

it("does not start a new runtime when the gateway port is already occupied", async () => {
  const directory = await fixture();
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => occupied.close(() => resolve())));
  const address = occupied.address();
  if (!address || typeof address === "string") throw new Error("Test port did not bind");
  const g = createPersistentGateway({ ...config, port: address.port }, directory, launch);
  await expect(g.listen()).rejects.toThrow();
  await expect(
    readFile(join(directory, "session-host", "host.json"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("replaces a dead host without erasing workspace bindings", async () => {
  const directory = await fixture();
  const first = await gateway(directory);
  const { c } = await connect(first.url);
  const id = randomUUID();
  await edit(c, { kind: "project.add", projectId: id, name: "Persisted", directory });
  const host = await ensureSessionHost(directory, launch);
  process.kill(host.pid, "SIGKILL");
  await expect
    .poll(
      () =>
        fetch(`${first.url}/health`)
          .then((r) => r.status)
          .catch(() => 0),
      { timeout: 15000 },
    )
    .toBe(200);
  const recovered = await connect(first.url);
  expect(recovered.c.workspace?.projects[0]?.id).toBe(id);
  expect((await ensureSessionHost(directory, launch)).pid).not.toBe(host.pid);
}, 30000);
