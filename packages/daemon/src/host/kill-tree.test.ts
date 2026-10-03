import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import spawn from "cross-spawn";
import { afterEach, expect, it, vi } from "vitest";
import { killTree, treeKillCommand } from "./kill-tree.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((p) => rm(p, { recursive: true, force: true })));
  directories.length = 0;
});

it("stops a Windows child's whole tree with taskkill and leaves other systems to kill()", () => {
  expect(treeKillCommand(1234, "win32")).toEqual({
    command: "taskkill",
    args: ["/PID", "1234", "/T", "/F"],
  });
  expect(treeKillCommand(1234, "linux")).toBeUndefined();
  expect(treeKillCommand(1234, "darwin")).toBeUndefined();
  // A child that never started has no tree to look up.
  expect(treeKillCommand(undefined, "win32")).toBeUndefined();
});

it("sends the signal itself outside Windows, and never taskkills an exited child", () => {
  const child = { pid: 1234, exitCode: null, signalCode: null, kill: vi.fn(() => true) };
  killTree(child, "SIGKILL", "linux");
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  // On Windows an exited child's pid may be reused; the tree is not looked up, kill() is a no-op.
  const exited = { pid: 1234, exitCode: 0, signalCode: null, kill: vi.fn(() => false) };
  killTree(exited, undefined, "win32");
  expect(exited.kill).toHaveBeenCalledWith(undefined);
});

it.skipIf(process.platform !== "win32")(
  "stops the program a .cmd shim started, so the child's close arrives",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "concors-kill-tree-"));
    directories.push(directory);
    const script = join(directory, "agent.cjs");
    const pidFile = join(directory, "agent.pid");
    await writeFile(
      script,
      `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);`,
    );
    const shim = join(directory, "agent.cmd");
    await writeFile(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    const child = spawn(shim, [], { stdio: "pipe", windowsHide: true });
    const closed = new Promise((resolve) => child.once("close", resolve));
    let agent = 0;
    await expect
      .poll(async () => (agent = Number(await readFile(pidFile, "utf8").catch(() => "0"))))
      .toBeGreaterThan(0);
    // The child is cmd.exe; the agent is its child and holds the same stdio pipes.
    expect(agent).not.toBe(child.pid);

    killTree(child);

    await closed;
    expect(() => process.kill(agent, 0)).toThrow();
  },
);
