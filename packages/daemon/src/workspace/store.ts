import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  ProjectSetupSchema,
  type ProjectSetup,
  type ProjectRequest,
  TerminalInfoSchema,
  type TerminalInfo,
  type TerminalRequest,
  applyWorkspaceOperation,
  WorkspaceOperationError,
  WorkspaceSnapshotSchema,
  WorkspaceResultSchema,
  type WorkspaceCommand,
  type WorkspaceResult,
  type WorkspaceSnapshot,
} from "@concors/protocol";

/** A single daemon owns this database. Layout and retry receipts commit atomically. */
export class WorkspaceStore {
  readonly #db: DatabaseSync;
  #closed = false;

  constructor(path = ":memory:") {
    this.#db = new DatabaseSync(path);
    try {
      this.#db.exec(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;",
      );
      const version = this.#db.prepare("PRAGMA user_version").get()?.["user_version"];
      if (version !== 0 && version !== 1 && version !== 2 && version !== 3)
        throw new Error(`Unsupported workspace database version: ${String(version)}`);
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS terminals (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, request TEXT NOT NULL, info TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS project_setups (id TEXT PRIMARY KEY, request TEXT NOT NULL, setup TEXT NOT NULL);
        PRAGMA user_version = 3;
      `);
      const initial: WorkspaceSnapshot = {
        schemaVersion: 1,
        machineId: randomUUID(),
        epoch: randomUUID(),
        revision: 0,
        projects: [],
        selection: null,
      };
      this.#db
        .prepare("INSERT OR IGNORE INTO workspace (id, snapshot) VALUES (1, ?)")
        .run(JSON.stringify(initial));
      this.snapshot(); // Fail startup on corrupt/incompatible persisted state; never silently reset it.
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  snapshot(): WorkspaceSnapshot {
    const row = this.#db.prepare("SELECT snapshot FROM workspace WHERE id = 1").get();
    return WorkspaceSnapshotSchema.parse(JSON.parse(String(row?.["snapshot"])));
  }

  execute(command: WorkspaceCommand): {
    result: WorkspaceResult;
    snapshot: WorkspaceSnapshot;
    changed: boolean;
  } {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.snapshot();
      const payload = JSON.stringify(command);
      const receipt = this.#db
        .prepare("SELECT payload, result FROM commands WHERE id = ?")
        .get(command.commandId);
      if (receipt) {
        const result =
          receipt["payload"] === payload
            ? WorkspaceResultSchema.parse(JSON.parse(String(receipt["result"])))
            : this.reject(
                command,
                "INVALID_OPERATION",
                "Command ID was already used for a different operation",
              );
        this.#db.exec("COMMIT");
        return { result, snapshot: current, changed: false };
      }
      let snapshot = current;
      let result: WorkspaceResult;
      try {
        if (command.epoch !== current.epoch)
          throw new WorkspaceOperationError(
            "CONFLICT",
            "Workspace was replaced. Refresh before editing.",
          );
        snapshot = applyWorkspaceOperation(current, command.operation);
        // Keep snapshot frames below the protocol's transport limit.
        if (Buffer.byteLength(JSON.stringify(snapshot)) > 512 * 1024)
          throw new WorkspaceOperationError("LIMIT_EXCEEDED", "Workspace metadata exceeds 512 KiB");
        this.#db
          .prepare("UPDATE workspace SET snapshot = ? WHERE id = 1")
          .run(JSON.stringify(snapshot));
        result = {
          type: "workspace.result",
          commandId: command.commandId,
          outcome: { status: "accepted", revision: snapshot.revision },
        };
      } catch (error) {
        if (!(error instanceof WorkspaceOperationError)) throw error;
        snapshot = current;
        result = this.reject(command, error.code, error.message);
      }
      this.#db
        .prepare("INSERT INTO commands (id, payload, result) VALUES (?, ?, ?)")
        .run(command.commandId, payload, JSON.stringify(result));
      this.#db.exec("COMMIT");
      return { result, snapshot, changed: result.outcome.status === "accepted" };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  projectSetups(): ProjectSetup[] {
    return this.#db
      .prepare("SELECT setup FROM project_setups ORDER BY rowid")
      .all()
      .map((row) => ProjectSetupSchema.parse(JSON.parse(String(row["setup"]))));
  }
  reserveProjectSetup(request: ProjectRequest, setup: ProjectSetup): boolean {
    const prior = this.#db.prepare("SELECT request FROM project_setups WHERE id = ?").get(setup.id);
    if (prior) {
      if (prior["request"] !== JSON.stringify(request))
        throw new Error("Project setup ID already used with different parameters");
      return false;
    }
    if (this.projectSetups().length >= 64)
      throw new Error("Project setup history limit reached (64)");
    this.#db
      .prepare("INSERT INTO project_setups (id, request, setup) VALUES (?, ?, ?)")
      .run(setup.id, JSON.stringify(request), JSON.stringify(setup));
    return true;
  }
  saveProjectSetup(setup: ProjectSetup): void {
    this.#db
      .prepare("UPDATE project_setups SET setup = ? WHERE id = ?")
      .run(JSON.stringify(ProjectSetupSchema.parse(setup)), setup.id);
  }

  terminals(): TerminalInfo[] {
    return this.#db
      .prepare("SELECT info FROM terminals ORDER BY rowid")
      .all()
      .map((row) => TerminalInfoSchema.parse(JSON.parse(String(row["info"]))));
  }

  terminal(id: string): TerminalInfo {
    const row = this.#db.prepare("SELECT info FROM terminals WHERE id = ?").get(id);
    if (!row) throw new Error("Terminal session no longer exists");
    return TerminalInfoSchema.parse(JSON.parse(String(row["info"])));
  }

  terminalRequest(request: TerminalRequest): TerminalInfo | null {
    const row = this.#db
      .prepare("SELECT request, info FROM terminals WHERE request_id = ?")
      .get(request.requestId);
    if (!row) return null;
    if (row["request"] !== JSON.stringify(request))
      throw new Error("Request ID was already used for another terminal launch");
    return TerminalInfoSchema.parse(JSON.parse(String(row["info"])));
  }

  /** Reserve the launch and bind its pane before spawning, so crashes never duplicate a launch. */
  reserveTerminal(request: TerminalRequest, info: TerminalInfo): WorkspaceSnapshot {
    const op = request.operation;
    if (op.kind !== "start") throw new Error("Expected a terminal start request");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.snapshot();
      if (state.epoch !== op.epoch)
        throw new Error("Workspace was replaced; refresh before starting a session");
      const project = state.projects.find((p) => p.id === op.projectId);
      const tab = project?.tabs.find((t) => t.id === op.tabId);
      const pane = tab?.nodes.find((n) => n.id === op.paneId);
      if (!project || !pane || pane.kind !== "pane") throw new Error("Pane no longer exists");
      if (project.version !== op.expectedVersion || pane.sessionId !== op.expectedSessionId)
        throw new Error("Pane changed on another client; refresh before starting");
      if (pane.profile === "chat" || pane.profile !== info.profile)
        throw new Error("Select a terminal profile before starting");
      if (pane.sessionId && ["running", "starting"].includes(this.terminal(pane.sessionId).status))
        throw new Error("This pane already has a running session");
      if (this.terminals().length >= 256)
        throw new Error("Terminal history limit reached (256 sessions)");
      pane.sessionId = info.id;
      project.version++;
      state.revision++;
      this.#db
        .prepare("INSERT INTO terminals (id, request_id, request, info) VALUES (?, ?, ?, ?)")
        .run(info.id, request.requestId, JSON.stringify(request), JSON.stringify(info));
      this.#db.prepare("UPDATE workspace SET snapshot = ? WHERE id = 1").run(JSON.stringify(state));
      this.#db.exec("COMMIT");
      return state;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  bindTerminal(request: TerminalRequest): void {
    const op = request.operation;
    if (op.kind !== "bind") throw new Error("Expected bind");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.snapshot();
      const session = this.terminal(op.sessionId);
      if (session.projectId !== op.projectId) throw new Error("Session belongs to another project");
      const project = state.projects.find((p) => p.id === op.projectId);
      const pane = project?.tabs
        .find((t) => t.id === op.tabId)
        ?.nodes.find((n) => n.id === op.paneId);
      if (!project || !pane || pane.kind !== "pane") throw new Error("Pane no longer exists");
      if (pane.sessionId === session.id) {
        this.#db.exec("COMMIT");
        return;
      }
      if (project.version !== op.expectedVersion || pane.sessionId !== null)
        throw new Error("Use an empty pane to attach this session");
      if (
        state.projects.some((p) =>
          p.tabs.some((t) => t.nodes.some((n) => n.kind === "pane" && n.sessionId === session.id)),
        )
      )
        throw new Error(
          "Session is already open in another pane; select that pane or close it before reattaching",
        );
      pane.sessionId = session.id;
      pane.profile = session.profile;
      project.version++;
      state.revision++;
      this.#db.prepare("UPDATE workspace SET snapshot = ? WHERE id = 1").run(JSON.stringify(state));
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  saveTerminal(info: TerminalInfo): void {
    this.#db
      .prepare("UPDATE terminals SET info = ? WHERE id = ?")
      .run(JSON.stringify(TerminalInfoSchema.parse(info)), info.id);
  }

  private reject(
    command: WorkspaceCommand,
    code: WorkspaceOperationError["code"],
    message: string,
  ): WorkspaceResult {
    return {
      type: "workspace.result",
      commandId: command.commandId,
      outcome: { status: "rejected", code, message },
    };
  }

  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      this.#db.close();
    }
  }
}
