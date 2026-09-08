import { detectTerminalAgent, readTerminalProcesses } from "./agent-process.ts";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { TerminalRequest, TerminalResult, TerminalInfo } from "@concors/protocol";
import type { WorkspaceStore } from "../workspace/store.ts";
import { resolveProfile } from "./profiles.ts";
import { TerminalRuntime, type TerminalViewer } from "./runtime.ts";

/** One runtime registry per machine, independent of every connected UI. */
export class TerminalManager {
  readonly #store: WorkspaceStore;
  readonly #runtimes = new Map<string, TerminalRuntime>();
  readonly #workspaceChanged: () => void;
  readonly #terminalChanged: (session: TerminalInfo) => void;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;
  #scanning = false;
  readonly #agentPoll: ReturnType<typeof setInterval>;

  constructor(
    store: WorkspaceStore,
    workspaceChanged: () => void,
    terminalChanged: (session: TerminalInfo) => void = () => undefined,
  ) {
    this.#agentPoll = setInterval(() => {
      void this.scanAgents();
    }, 1000);
    this.#agentPoll.unref();
    this.#store = store;
    this.#workspaceChanged = workspaceChanged;
    this.#terminalChanged = terminalChanged;
    for (const session of store.terminals())
      if (session.status === "running" || session.status === "starting") {
        this.save({
          ...session,
          status: "interrupted",
          error: "Daemon restarted; the previous process is no longer attached",
        });
      }
  }

  private async scanAgents(): Promise<void> {
    if (this.#closed || this.#scanning) return;
    const shells = [...this.#runtimes.values()].filter(
      (runtime) => runtime.info.profile === "shell" && runtime.info.status === "running",
    );
    if (!shells.length) return;
    this.#scanning = true;
    try {
      const processes = await readTerminalProcesses();
      if (this.#closed) return;
      for (const runtime of shells)
        runtime.detectAgent(detectTerminalAgent(runtime.pid, processes));
    } catch {
      // Process enumeration can be unavailable temporarily; retain the last observed state.
    } finally {
      this.#scanning = false;
    }
  }

  private save(session: TerminalInfo): void {
    this.#store.saveTerminal(session);
    this.#terminalChanged(session);
  }

  request(viewer: TerminalViewer, request: TerminalRequest): Promise<TerminalResult> {
    // Serialize launches around async directory validation; duplicate clicks cannot race a spawn.
    const operation = this.#queue.then(async (): Promise<TerminalResult> => {
      try {
        if (this.#closed || !viewer.active()) throw new Error("Connection is closed");
        const sessions = await this.handle(viewer, request);
        return {
          type: "terminal.result",
          requestId: request.requestId,
          outcome: { status: "ok", sessions },
        };
      } catch (error) {
        return {
          type: "terminal.result",
          requestId: request.requestId,
          outcome: {
            status: "error",
            message: error instanceof Error ? error.message : "Terminal operation failed",
          },
        };
      }
    });
    this.#queue = operation;
    return operation;
  }

  private async handle(viewer: TerminalViewer, request: TerminalRequest): Promise<TerminalInfo[]> {
    const op = request.operation;
    if (op.kind === "list") return this.#store.terminals();
    if (op.kind === "start") return [await this.start(request, viewer)];
    if (op.kind === "bind") {
      this.#store.bindTerminal(request);
      this.#workspaceChanged();
      return [this.#store.terminal(op.sessionId)];
    }
    const info = this.#store.terminal(op.sessionId);
    const runtime = this.#runtimes.get(op.sessionId);
    if (op.kind === "detach") {
      runtime?.detach(viewer.id);
      return [info];
    }
    if (op.kind === "attach") {
      if (runtime) await runtime.attach(viewer);
      else
        viewer.send({
          type: "terminal.snapshot",
          session: info,
          sequence: 0,
          data: "",
          ownerId: null,
          viewerId: viewer.id,
        });
      return [runtime?.info ?? info];
    }
    if (op.kind === "stop") {
      await runtime?.stop();
      return [runtime?.info ?? info];
    }
    if (!runtime) throw new Error("Terminal process is no longer running");
    runtime.resize(
      viewer.id,
      op.cols,
      op.rows,
      op.kind === "claim",
      op.kind === "claim" && op.ifUnowned === true,
    );
    return [runtime.info];
  }

  private async start(request: TerminalRequest, viewer: TerminalViewer): Promise<TerminalInfo> {
    const op = request.operation;
    if (op.kind !== "start") throw new Error("Expected start");
    const prior = this.#store.terminalRequest(request);
    if (prior) return prior;
    const state = this.#store.snapshot();
    const project = state.projects.find((p) => p.id === op.projectId);
    const pane = project?.tabs
      .find((t) => t.id === op.tabId)
      ?.nodes.find((n) => n.id === op.paneId);
    if (!project || !pane || pane.kind !== "pane") throw new Error("Pane no longer exists");
    if (pane.profile === "chat") throw new Error("Unified chat is not a terminal profile");
    if (op.recover && pane.sessionId !== op.expectedSessionId && pane.sessionId) {
      // Another attached client already recovered this pane. Return its binding, not a second PTY.
      const current = this.#store.terminal(pane.sessionId);
      if (state.epoch === op.epoch && ["running", "starting"].includes(current.status))
        return current;
    }
    const lost = op.recover && pane.sessionId ? this.#store.terminal(pane.sessionId) : null;
    if (op.recover && (!lost || lost.status !== "interrupted"))
      throw new Error("This terminal does not need recovery");
    if (!isAbsolute(project.directory))
      throw new Error("Use an absolute project directory on this machine");
    const directory = await realpath(project.directory);
    if (!(await stat(directory)).isDirectory()) throw new Error("Project path is not a directory");
    const recoveryProfile = lost?.detectedAgent ?? pane.profile;
    const command = resolveProfile(
      op.recover ? recoveryProfile : pane.profile,
      process.platform,
      process.env,
      !!op.recover,
    );
    if (this.#closed || !viewer.active()) throw new Error("Connection closed before launch");
    if ([...this.#runtimes.values()].filter((r) => r.info.status === "running").length >= 16)
      throw new Error("Maximum of 16 running terminals reached; stop a session first");
    if (this.#runtimes.size >= 32) {
      const stopped = [...this.#runtimes.values()].find((r) => r.info.status !== "running");
      if (stopped) {
        stopped.dispose();
        this.#runtimes.delete(stopped.info.id);
      }
    }
    const info: TerminalInfo = {
      id: randomUUID(),
      projectId: project.id,
      profile: pane.profile,
      directory,
      status: "starting",
      exitCode: null,
      error: null,
      startedAt: new Date().toISOString(),
      cols: op.cols,
      rows: op.rows,
    };
    this.#store.reserveTerminal(request, info);
    this.#workspaceChanged();
    this.#terminalChanged(info);
    try {
      const runtime = new TerminalRuntime(info, command, (session) => this.save(session));
      this.#runtimes.set(info.id, runtime);
      return runtime.info;
    } catch (error) {
      const failed: TerminalInfo = {
        ...info,
        status: "failed",
        error: error instanceof Error ? error.message : "Could not launch terminal",
      };
      this.save(failed);
      return failed;
    }
  }

  input(viewer: TerminalViewer, sessionId: string, data: string): void {
    try {
      const runtime = this.#runtimes.get(sessionId);
      if (!runtime) throw new Error("Terminal process is no longer running");
      runtime.input(viewer.id, data);
    } catch (error) {
      viewer.send({
        type: "terminal.error",
        sessionId,
        message: error instanceof Error ? error.message : "Could not send input",
      });
    }
  }

  detach(viewerId: string): void {
    for (const runtime of this.#runtimes.values()) runtime.detach(viewerId);
  }
  close(): void {
    this.#closed = true;
    clearInterval(this.#agentPoll);
    for (const runtime of this.#runtimes.values()) runtime.dispose();
    this.#runtimes.clear();
  }
}
