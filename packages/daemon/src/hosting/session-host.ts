import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm, stat, open, realpath, rename } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { createDaemonServer, type DaemonServerOptions } from "../server.ts";
import type { DaemonConfig } from "../config.ts";

const Descriptor = z.object({
  protocol: z.literal(1),
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export type HostDescriptor = z.infer<typeof Descriptor>;
const hostDirectory = (directory: string) => join(directory, "session-host");

async function descriptor(directory: string): Promise<HostDescriptor | null> {
  try {
    return Descriptor.parse(
      JSON.parse(await readFile(join(hostDirectory(directory), "host.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function hostHealthy(host: HostDescriptor): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${host.port}/health`, {
      headers: { authorization: `Bearer ${host.token}` },
      signal: AbortSignal.timeout(1000),
    });
    return response.ok && response.headers.get("x-concors-host") === "1";
  } catch {
    return false;
  }
}

/** Exclusive ownership of the runtime database, including across concurrent gateway starts. */
async function claim(directory: string): Promise<boolean> {
  const lock = hostDirectory(directory);
  try {
    await mkdir(lock, { mode: 0o700 });
    await writeFile(join(lock, "owner.tmp"), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    await rename(join(lock, "owner.tmp"), join(lock, "owner.json"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  let owner: string | null = null;
  try {
    owner = await readFile(join(lock, "owner.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (owner && alive(z.object({ pid: z.number().int().positive() }).parse(JSON.parse(owner)).pid))
    return false;
  // A creator may not yet have written its PID. Never remove a fresh incomplete lock.
  if (!owner && Date.now() - (await stat(lock)).mtimeMs < 15000) return false;
  try {
    const reaper = await open(join(lock, "reaping"), "wx", 0o600);
    await reaper.close();
  } catch (error) {
    if (["EEXIST", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
  // Another starter cannot replace a directory while this reaper owns it.
  const current = await readFile(join(lock, "owner.json"), "utf8").catch(() => null);
  if (current !== owner) {
    await rm(join(lock, "reaping"), { force: true });
    return false;
  }
  await rm(lock, { recursive: true });
  return claim(directory);
}

export async function runSessionHost(
  directory: string,
  config: DaemonConfig,
  options: Pick<DaemonServerOptions, "agentProviderFactory"> = {},
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  directory = await realpath(directory);
  if (!(await claim(directory))) return;
  const token = randomBytes(32).toString("hex");
  const server = createDaemonServer(
    { ...config, host: "127.0.0.1", port: 0 },
    {
      ...options,
      workspacePath: join(directory, "workspace.sqlite"),
      internalToken: token,
    },
  );
  let closing: Promise<void> | undefined;
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const close = () =>
    (closing ??= (async () => {
      await server.close();
      await rm(hostDirectory(directory), { recursive: true, force: true });
      finish();
    })());
  server.app.addHook("onSend", async (_request, reply) => {
    reply.header("x-concors-host", "1");
  });
  server.app.post("/internal/stop", async (_request, reply) => {
    reply.send({ status: "stopping" });
    setImmediate(() => void close());
  });
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  try {
    const url = new URL(await server.listen());
    const host: HostDescriptor = { protocol: 1, pid: process.pid, port: Number(url.port), token };
    await writeFile(join(hostDirectory(directory), "host.tmp"), JSON.stringify(host), {
      mode: 0o600,
    });
    await rename(
      join(hostDirectory(directory), "host.tmp"),
      join(hostDirectory(directory), "host.json"),
    );
    await finished;
  } catch (error) {
    await close();
    throw error;
  }
}

export interface HostLaunch {
  executable: string;
  args: string[];
}

export async function ensureSessionHost(
  directory: string,
  launch: HostLaunch,
): Promise<HostDescriptor> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  directory = await realpath(directory);
  const existing = await descriptor(directory);
  if (existing && (await hostHealthy(existing))) return existing;
  // A live but unresponsive runtime must not be replaced or have its database opened twice.
  if (existing && alive(existing.pid))
    throw new Error("The session host is still reconnecting. Try again shortly.");
  const log = await open(join(directory, "session-host.log"), "a", 0o600);
  let launchError: Error | undefined;
  const child = spawn(launch.executable, launch.args, {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", log.fd, log.fd],
    env: { ...process.env, CONCORS_DATA_DIR: directory },
  });
  child.on("error", (error) => {
    launchError = error;
  });
  child.unref();
  await log.close();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    const host = await descriptor(directory);
    if (host && (await hostHealthy(host))) return host;
    if (child.exitCode !== null && child.exitCode !== 0)
      throw new Error(
        "Session host could not start. See session-host.log in the machine data folder.",
      );
    await delay(100);
  }
  throw new Error("Session host startup timed out. Existing sessions have not been stopped.");
}

export async function stopSessionHost(directory: string): Promise<void> {
  const resolved = await realpath(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!resolved) return;
  const host = await descriptor(resolved);
  if (!host || !(await hostHealthy(host))) return;
  const response = await fetch(`http://127.0.0.1:${host.port}/internal/stop`, {
    method: "POST",
    headers: { authorization: `Bearer ${host.token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Could not stop the session host");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await hostHealthy(host))) return;
    await delay(50);
  }
  throw new Error("Session host is still stopping");
}

/** Service-manager readiness barrier; unlike ensureSessionHost, never launches a competing host. */
export async function waitForSessionHost(directory: string): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const host = await descriptor(directory);
    if (host && (await hostHealthy(host))) return;
    await delay(100);
  }
  throw new Error("Session host did not become ready");
}
