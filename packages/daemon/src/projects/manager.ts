import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { projectDirectory, projectDirectoryError } from "./directories.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, realpath, stat, opendir } from "node:fs/promises";
import { isAbsolute, dirname, basename, join, sep } from "node:path";
import type { ProjectRequest, ProjectResult, ProjectSetup } from "@concors/protocol";
import { nextWorkspaceTabName } from "@concors/protocol";
import type { WorkspaceStore } from "../workspace/store.ts";

export function validateRepository(repository: string): void {
  if (isAbsolute(repository)) return; // Local repositories are useful without internet access.
  if (/^[\w.-]+@[\w.-]+:[\w./~-]+$/.test(repository)) return;
  try {
    const url = new URL(repository);
    if (
      !["https:", "ssh:"].includes(url.protocol) ||
      url.password ||
      (url.protocol === "https:" && url.username) ||
      !url.hostname
    )
      throw new Error();
    return;
  } catch {
    throw new Error(
      "Use an HTTPS/SSH repository URL or an absolute local repository path; embedded credentials are not supported",
    );
  }
}

/** Durable jobs outlive client connections. A project is registered only after setup succeeds. */
export class ProjectManager {
  readonly #store: WorkspaceStore;
  readonly #changed: () => void;
  readonly #children = new Map<string, ChildProcess>();
  readonly #cancelled = new Set<string>();
  #closed = false;
  readonly #home: string;
  constructor(store: WorkspaceStore, changed: () => void, home = homedir()) {
    this.#home = home;
    this.#store = store;
    this.#changed = changed;
    for (const setup of store.projectSetups())
      if (setup.status === "working") {
        // Registering a completed project and updating its job can be separated by a crash.
        const registered = store.snapshot().projects.some((p) => p.id === setup.id);
        store.saveProjectSetup({
          ...setup,
          status: registered ? "done" : "interrupted",
          progress: registered
            ? "Project ready"
            : "Daemon restarted. Inspect the destination before retrying; files were preserved.",
        });
      }
  }
  request(request: ProjectRequest): ProjectResult {
    try {
      if (this.#closed) throw new Error("Daemon is stopping");
      const op = request.operation;
      if (op.kind === "browse") throw new Error("Use the directory browser endpoint");
      if (op.kind === "cancel") {
        const setup = this.#store.projectSetups().find((s) => s.id === op.id);
        if (!setup) throw new Error("Project setup no longer exists");
        if (setup.status === "working") {
          this.#cancelled.add(op.id);
          this.kill(op.id);
        }
      } else {
        if (op.epoch !== this.#store.snapshot().epoch)
          throw new Error("Workspace was replaced; refresh before starting");
        const quick = op.kind === "workspace";
        const directory = projectDirectory(quick ? "~" : op.directory, this.#home);
        if (!quick && op.mode === "clone") validateRepository(op.repository);
        const existing = this.#store.projectSetups();
        if (
          !existing.some((s) => s.id === op.id) &&
          existing.filter((s) => s.status === "working").length >= 4
        )
          throw new Error("Wait for a project setup to finish (maximum 4)");
        const setup: ProjectSetup = {
          id: op.id,
          mode: quick ? "open" : op.mode,
          name: quick ? "Workspace" : op.name || basename(directory).slice(0, 120) || directory,
          ...(quick ? { directoryMode: "follow" as const } : {}),
          directory,
          repository: quick ? "" : op.repository,
          status: "working",
          progress: "Preparing project…",
        };
        if (this.#store.reserveProjectSetup(request, setup)) {
          this.#changed();
          void this.run(setup, op.epoch);
        }
      }
      return { type: "project.result", requestId: request.requestId, outcome: { status: "ok" } };
    } catch (error) {
      return {
        type: "project.result",
        requestId: request.requestId,
        outcome: {
          status: "error",
          message: error instanceof Error ? error.message : "Project setup failed",
        },
      };
    }
  }
  async browse(request: ProjectRequest): Promise<ProjectResult> {
    try {
      const op = request.operation;
      if (this.#closed || op.kind !== "browse" || op.epoch !== this.#store.snapshot().epoch)
        throw new Error("Reconnect before browsing this machine.");
      const directory = await realpath(projectDirectory(op.directory || "~", this.#home));
      const entries: { name: string; directory: string }[] = [];
      let scanned = 0,
        truncated = false;
      for await (const entry of await opendir(directory)) {
        if (++scanned > 10000 || entries.length === 500) {
          truncated = true;
          break;
        }
        // Links may be entered explicitly; no recursive traversal or reads of file contents.
        if (entry.isDirectory())
          entries.push({ name: entry.name, directory: join(directory, entry.name) });
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return {
        type: "project.result",
        requestId: request.requestId,
        outcome: {
          status: "listed",
          directory,
          parent: dirname(directory) === directory ? null : dirname(directory),
          home: this.#home,
          entries,
          truncated,
        },
      };
    } catch (error) {
      return {
        type: "project.result",
        requestId: request.requestId,
        outcome: {
          status: "error",
          message: projectDirectoryError(
            error,
            request.operation.kind === "browse" ? (request.operation.directory ?? "~") : "",
            false,
          ),
        },
      };
    }
  }

  private save(setup: ProjectSetup): void {
    if (!this.#closed) {
      this.#store.saveProjectSetup(setup);
      this.#changed();
    }
  }
  private check(id: string): void {
    if (this.#closed || this.#cancelled.has(id)) throw new Error("Setup cancelled.");
  }
  private async run(setup: ProjectSetup, epoch: string): Promise<void> {
    let created = false;
    try {
      let directory: string;
      if (setup.mode === "open") {
        directory = await realpath(setup.directory);
        if (!(await stat(directory)).isDirectory())
          throw new Error("Project path must be a directory");
      } else {
        this.check(setup.id);
        const repos = join(this.#home, "repos");
        const requestedParent = dirname(setup.directory);
        if (requestedParent === repos || requestedParent.startsWith(`${repos}${sep}`))
          await mkdir(requestedParent, { recursive: true });
        const parent = await realpath(requestedParent);
        directory = join(parent, basename(setup.directory));
        this.check(setup.id);
        // Exclusive creation never overwrites an existing folder, even an empty one.
        await mkdir(directory);
        created = true;
      }
      this.check(setup.id);
      setup = { ...setup, directory };
      this.save(setup);
      if (setup.mode === "clone") await this.clone(setup);
      this.check(setup.id);
      const existing =
        setup.directoryMode !== "follow" &&
        this.#store.snapshot().projects.find((p) => p.directory === directory);
      if (existing) {
        const selected = this.#store.snapshot().selection;
        const result = this.#store.execute({
          type: "workspace.command",
          commandId: setup.id,
          epoch,
          operation: {
            kind: "selection.set",
            projectId: existing.id,
            tabId:
              selected?.projectId === existing.id ? selected.tabId : (existing.tabs[0]?.id ?? null),
          },
        });
        if (result.result.outcome.status === "rejected")
          throw new Error(result.result.outcome.message);
        this.save({ ...setup, projectId: existing.id, status: "done", progress: "Folder opened" });
        return;
      }
      const result = this.#store.execute({
        type: "workspace.command",
        commandId: setup.id,
        epoch,
        operation: {
          kind: "project.add",
          projectId: setup.id,
          name: setup.name,
          directory,
          ...(setup.directoryMode ? { directoryMode: setup.directoryMode } : {}),
        },
      });
      if (result.result.outcome.status === "rejected")
        throw new Error(result.result.outcome.message);
      const project = this.#store.snapshot().projects.find((item) => item.id === setup.id);
      if (!project) throw new Error("Created project is unavailable");
      const terminal = this.#store.execute({
        type: "workspace.command",
        commandId: randomUUID(),
        epoch,
        operation: {
          kind: "tab.create",
          projectId: project.id,
          expectedVersion: project.version,
          tabId: randomUUID(),
          paneId: randomUUID(),
          name: nextWorkspaceTabName(project.tabs),
          profile: "shell",
        },
      });
      if (terminal.result.outcome.status === "rejected")
        throw new Error(terminal.result.outcome.message);
      this.save({ ...setup, projectId: project.id, status: "done", progress: "Ready" });
    } catch (error) {
      this.save({
        ...setup,
        status: this.#cancelled.has(setup.id) ? "cancelled" : "failed",
        progress: projectDirectoryError(error, setup.directory, created),
      });
    } finally {
      this.#cancelled.delete(setup.id);
    }
  }
  private clone(setup: ProjectSetup): Promise<void> {
    return new Promise((resolve, reject) => {
      let output = "",
        timer: ReturnType<typeof setTimeout> | undefined;
      const child = spawn(
        "git",
        [
          "-c",
          "credential.interactive=false",
          "-c",
          "protocol.ext.allow=never",
          "clone",
          "--progress",
          "--",
          setup.repository,
          setup.directory,
        ],
        {
          shell: false,
          detached: process.platform !== "win32",
          stdio: ["ignore", "ignore", "pipe"],
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GCM_INTERACTIVE: "never",
            GIT_SSH_COMMAND: "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes",
          },
        },
      );
      this.#children.set(setup.id, child);
      const publish = () => {
        timer = undefined;
        this.save({ ...setup, progress: output.slice(-4096) });
      };
      child.stderr?.on("data", (data: Buffer) => {
        output = (output + data.toString("utf8"))
          // eslint-disable-next-line no-control-regex -- Strip terminal escape sequences from Git progress.
          .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
          .slice(-4096);
        if (!timer) timer = setTimeout(publish, 100);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        this.#children.delete(setup.id);
        if (code === 0) resolve();
        else reject(new Error(output || `Git exited with code ${code}`));
      });
    });
  }
  private kill(id: string): void {
    const child = this.#children.get(id);
    if (!child?.pid) return;
    const pid = child.pid;
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.on("error", () => child.kill());
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* Already exited. */
      }
      const timer = setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }, 2000);
      timer.unref();
      child.once("close", () => clearTimeout(timer));
    }
  }
  close(): void {
    if (this.#closed) return;
    for (const setup of this.#store.projectSetups())
      if (setup.status === "working") {
        this.#store.saveProjectSetup({
          ...setup,
          status: "interrupted",
          progress: "Daemon stopped. Destination files were preserved.",
        });
        this.kill(setup.id);
      }
    this.#closed = true;
  }
}
