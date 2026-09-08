import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import headless from "@xterm/headless";
import type { TerminalEvent } from "@concors/protocol";
import { expect, it, vi } from "vitest";
import { terminalEnvironment } from "./environment.ts";
import { TerminalRuntime } from "./runtime.ts";

it("removes daemon color overrides without changing unrelated environment or the source", () => {
  const source = {
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    CLICOLOR: "0",
    CLICOLOR_FORCE: "0",
    PATH: "/bin",
    TERM: "dumb",
  };
  const env = terminalEnvironment(source);
  expect(env).toMatchObject({
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    CLICOLOR: "1",
    PATH: "/bin",
  });
  expect(env["NO_COLOR"]).toBeUndefined();
  expect(env["FORCE_COLOR"]).toBeUndefined();
  expect(source.NO_COLOR).toBe("1");
});

it("a real PTY enables colors and preserves ANSI, indexed and true colors through screen replay", async () => {
  vi.stubEnv("NO_COLOR", "1");
  const events: TerminalEvent[] = [];
  const script = `
    const e=process.env;
    console.log(process.stdout.isTTY && !('NO_COLOR' in e) && e.TERM==='xterm-256color' && e.COLORTERM==='truecolor' ? 'COLOR_ENV_OK' : 'COLOR_ENV_BAD');
    process.stdout.write('\\x1b[31mANSI\\x1b[0m\\r\\n\\x1b[38;5;196mINDEXED\\x1b[0m\\r\\n\\x1b[38;2;51;93;206mCOBALT\\x1b[0m\\r\\n');
    setTimeout(()=>process.exit(0),100);
  `;
  const directory = await mkdtemp(join(tmpdir(), "concors-colors-"));
  const fixture = join(directory, "colors.cjs");
  await writeFile(fixture, script);
  const runtime = new TerminalRuntime(
    {
      id: randomUUID(),
      projectId: randomUUID(),
      profile: "shell",
      directory,
      status: "starting",
      exitCode: null,
      error: null,
      startedAt: new Date().toISOString(),
      cols: 100,
      rows: 24,
    },
    { command: process.execPath, args: [fixture] },
    () => undefined,
  );
  const screen = new headless.Terminal({ cols: 100, rows: 24, allowProposedApi: true });
  try {
    await runtime.attach({ id: "first", active: () => true, send: (event) => events.push(event) });
    await expect.poll(() => runtime.info.status, { timeout: 10000 }).toBe("exited");
    await runtime.attach({
      id: "reconnected",
      active: () => true,
      send: (event) => events.push(event),
    });
    const snapshot = events.findLast((event) => event.type === "terminal.snapshot");
    if (!snapshot || snapshot.type !== "terminal.snapshot") throw new Error("No terminal snapshot");
    await new Promise<void>((resolve) => screen.write(snapshot.data, resolve));
    expect(screen.buffer.active.getLine(0)?.translateToString(true)).toBe("COLOR_ENV_OK");
    expect(screen.buffer.active.getLine(1)?.getCell(0)?.getFgColor()).toBe(1);
    expect(screen.buffer.active.getLine(2)?.getCell(0)?.getFgColor()).toBe(196);
    expect(screen.buffer.active.getLine(3)?.getCell(0)?.getFgColor()).toBe(0x335dce);
  } finally {
    runtime.dispose();
    screen.dispose();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 15000);
