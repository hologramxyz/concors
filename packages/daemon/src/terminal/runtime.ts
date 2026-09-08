import { terminalEnvironment } from "./environment.ts";
import * as pty from "node-pty";
import headless from "@xterm/headless";
import serialize from "@xterm/addon-serialize";
import type { TerminalEvent, TerminalInfo } from "@concors/protocol";
import { TerminalOutputCoalescer } from "./output-coalescer.ts";

export interface TerminalViewer {
  id: string;
  send: (event: TerminalEvent) => void;
  active: () => boolean;
}

/** PTY + emulator survive client detach. Snapshots are serialized screen state, not ANSI tails. */
export class TerminalRuntime {
  info: TerminalInfo;
  readonly #pty: pty.IPty;
  readonly #screen: headless.Terminal;
  readonly #serializer: serialize.SerializeAddon;
  readonly #viewers = new Map<string, TerminalViewer>();
  readonly #coalescer: TerminalOutputCoalescer;
  #owner: string | null = null;
  #sequence = 0;
  #disposed = false;
  #queuedBytes = 0;
  #paused = false;
  #stopped = false;
  #resolveExit: () => void = () => undefined;
  readonly #exit: Promise<void>;
  readonly #save: (info: TerminalInfo) => void;

  constructor(
    info: TerminalInfo,
    command: { command: string; args: string[] | string },
    save: (info: TerminalInfo) => void,
  ) {
    this.info = info;
    this.#exit = new Promise((resolve) => {
      this.#resolveExit = resolve;
    });
    this.#save = save;
    this.#screen = new headless.Terminal({
      cols: info.cols,
      rows: info.rows,
      scrollback: 500,
      allowProposedApi: true,
    });
    this.#serializer = new serialize.SerializeAddon();
    this.#screen.loadAddon(this.#serializer);
    this.#coalescer = new TerminalOutputCoalescer({
      timers: { setTimeout, clearTimeout },
      onFlush: ({ payload }) => {
        this.#sequence++;
        this.emit({
          type: "terminal.output",
          sessionId: this.info.id,
          sequence: this.#sequence,
          data: payload.toString("utf8"),
        });
      },
    });
    try {
      this.#pty = pty.spawn(command.command, command.args, {
        name: "xterm-256color",
        cols: info.cols,
        rows: info.rows,
        cwd: info.directory,
        env: terminalEnvironment(process.env),
      });
    } catch (error) {
      this.#coalescer.dispose();
      this.#screen.dispose();
      throw error;
    }
    this.info = { ...info, status: "running" };
    try {
      this.#save(this.info);
    } catch (error) {
      this.#pty.kill();
      this.#coalescer.dispose();
      this.#screen.dispose();
      throw error;
    }
    this.#pty.onData((data) => {
      if (this.#disposed) return;
      this.#queuedBytes += Buffer.byteLength(data);
      if (this.#queuedBytes > 256 * 1024 && !this.#paused) {
        this.#pty.pause();
        this.#paused = true;
      }
      this.#screen.write(data, () => {
        if (this.#disposed) return;
        this.#queuedBytes -= Buffer.byteLength(data);
        if (this.#paused && this.#queuedBytes < 64 * 1024) {
          this.#paused = false;
          this.#pty.resume();
        }
        this.#coalescer.handle(data);
      });
    });
    this.#pty.onExit(({ exitCode }) => {
      if (this.#disposed) return;
      this.#screen.write("", () => {
        if (this.#disposed) return;
        this.#coalescer.flush();
        this.info = {
          ...this.info,
          status: this.#stopped || exitCode === 0 ? "exited" : "failed",
          exitCode,
        };
        this.#owner = null;
        this.#save(this.info);
        this.emitOwner();
        this.#resolveExit();
      });
    });
  }

  get pid(): number {
    return this.#pty.pid;
  }

  detectAgent(agent: TerminalInfo["detectedAgent"]): void {
    if (this.#disposed || this.info.status !== "running" || this.info.profile !== "shell") return;
    if ((this.info.detectedAgent ?? null) === (agent ?? null)) return;
    this.info = { ...this.info, detectedAgent: agent ?? null };
    this.#save(this.info);
  }

  attach(viewer: TerminalViewer): Promise<void> {
    return new Promise((resolve) => {
      // Queue a barrier behind all preceding PTY output before capturing sequence + screen.
      this.#screen.write("", () => {
        if (this.#disposed || !viewer.active()) {
          resolve();
          return;
        }
        this.#coalescer.flush();
        let data = this.#serializer.serialize({ scrollback: 200 });
        if (Buffer.byteLength(data) > 1024 * 1024)
          data = this.#serializer.serialize({ scrollback: 0 });
        viewer.send({
          type: "terminal.snapshot",
          session: this.info,
          sequence: this.#sequence,
          data,
          ownerId: this.#owner,
          viewerId: viewer.id,
        });
        this.#viewers.set(viewer.id, viewer);
        resolve();
      });
    });
  }

  detach(viewerId: string): void {
    this.#viewers.delete(viewerId);
    if (this.#owner === viewerId) {
      this.#owner = null;
      this.emitOwner();
    }
  }

  resize(viewerId: string, cols: number, rows: number, claim: boolean, ifUnowned = false): void {
    if (!this.#viewers.has(viewerId)) throw new Error("Attach before controlling this terminal");
    if (this.info.status !== "running") throw new Error("Terminal is not running");
    // Paseo's claim/update contract: passive views never steal size ownership.
    if (claim && ifUnowned && this.#owner !== null && this.#owner !== viewerId) return;
    if (claim) this.#owner = viewerId;
    if (this.#owner !== viewerId)
      throw new Error("Another client controls this terminal; take control first");
    if (this.info.cols !== cols || this.info.rows !== rows) {
      this.#pty.resize(cols, rows);
      this.#screen.resize(cols, rows);
      this.info = { ...this.info, cols, rows };
      this.#save(this.info);
    }
    this.emitOwner();
  }

  input(viewerId: string, data: string): void {
    if (!this.#viewers.has(viewerId) || this.#owner !== viewerId)
      throw new Error("Take control before typing");
    if (this.info.status !== "running") throw new Error("Terminal is not running");
    this.#pty.write(data);
  }

  async stop(): Promise<void> {
    if (this.info.status !== "running") return;
    if (!this.#stopped) {
      this.#stopped = true;
      this.#pty.kill();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#exit,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Terminal did not exit after stop")), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#coalescer.dispose();
    if (this.info.status === "running") {
      this.#pty.kill();
      this.info = {
        ...this.info,
        status: "interrupted",
        error: "Daemon stopped; start a new terminal to continue",
      };
      this.#save(this.info);
    }
    this.#resolveExit();
    this.#viewers.clear();
    this.#screen.dispose();
  }

  private emit(event: TerminalEvent): void {
    for (const viewer of this.#viewers.values()) viewer.send(event);
  }
  private emitOwner(): void {
    this.emit({
      type: "terminal.owner",
      sessionId: this.info.id,
      ownerId: this.#owner,
      cols: this.info.cols,
      rows: this.info.rows,
    });
  }
}
