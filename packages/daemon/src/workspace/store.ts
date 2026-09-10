import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  AgentInfoSchema,
  AgentItemSchema,
  type AgentInfo,
  type AgentItem,
  type AgentRequest,
  type AgentConversation,
} from "@concors/protocol";
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
  readonly attachmentsDirectory: string;
  #closed = false;

  constructor(path = ":memory:") {
    this.attachmentsDirectory =
      path === ":memory:"
        ? join(tmpdir(), "concors-attachments-" + randomUUID())
        : join(dirname(resolve(path)), "attachments");
    this.#db = new DatabaseSync(path);
    try {
      this.#db.exec(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;",
      );
      const version = this.#db.prepare("PRAGMA user_version").get()?.["user_version"];
      if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4)
        throw new Error(`Unsupported workspace database version: ${String(version)}`);
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS project_directories (project_id TEXT NOT NULL, directory TEXT NOT NULL, PRIMARY KEY(project_id, directory));
        CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS terminals (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, request TEXT NOT NULL, info TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS project_setups (id TEXT PRIMARY KEY, request TEXT NOT NULL, setup TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, info TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_items (position INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, item_id TEXT NOT NULL, item TEXT NOT NULL, UNIQUE(session_id, item_id));
        CREATE TABLE IF NOT EXISTS agent_requests (id TEXT PRIMARY KEY, request TEXT NOT NULL, session_id TEXT NOT NULL);
        PRAGMA user_version = 4;
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
        this.rememberDirectories(current);
        this.rememberDirectories(snapshot);
        if (command.operation.kind === "project.remove")
          this.#db
            .prepare("DELETE FROM project_directories WHERE project_id = ?")
            .run(command.operation.projectId);
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

  private rememberDirectories(state: WorkspaceSnapshot): void {
    const insert = this.#db.prepare(
      "INSERT OR IGNORE INTO project_directories (project_id, directory) VALUES (?, ?)",
    );
    for (const project of state.projects) {
      insert.run(project.id, project.directory);
      for (const node of project.tabs.flatMap((tab) => tab.nodes))
        if (node.kind === "pane" && node.directory) insert.run(project.id, node.directory);
    }
  }

  /** File tabs keep their original root even when the workspace follows a terminal elsewhere. */
  fileDirectory(projectId: string, requested?: string): string {
    const project = this.snapshot().projects.find((item) => item.id === projectId);
    if (!project) throw new Error("Project is no longer available.");
    const directory = requested ?? project.directory;
    if (
      directory !== project.directory &&
      !this.#db
        .prepare("SELECT 1 FROM project_directories WHERE project_id = ? AND directory = ?")
        .get(projectId, directory)
    )
      throw new Error("This folder does not belong to the workspace.");
    return directory;
  }

  /** Observations change the snapshot revision, not the user's layout edit version. */
  observeDirectory(sessionId: string, directory: string, root: string): boolean {
    const state = this.snapshot();
    const project = state.projects.find((item) =>
      item.tabs.some((tab) =>
        tab.nodes.some((node) => node.kind === "pane" && node.sessionId === sessionId),
      ),
    );
    const pane = project?.tabs
      .flatMap((tab) => tab.nodes)
      .find((node) => node.kind === "pane" && node.sessionId === sessionId);
    if (!project || !pane || pane.kind !== "pane" || pane.directory === directory) return false;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.rememberDirectories(state);
      pane.directory = directory;
      if (project.directoryMode === "follow" && project.followPaneId === pane.id) {
        project.directory = root;
        project.name =
          root.split(/[\\/]/).filter(Boolean).at(-1)?.trim().slice(0, 120) || "Workspace";
      }
      state.revision++;
      WorkspaceSnapshotSchema.parse(state);
      if (Buffer.byteLength(JSON.stringify(state)) > 512 * 1024)
        throw new Error("Workspace metadata exceeds 512 KiB");
      this.rememberDirectories(state);
      this.#db.prepare("UPDATE workspace SET snapshot = ? WHERE id = 1").run(JSON.stringify(state));
      this.#db.exec("COMMIT");
      return true;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  projectSetups(): ProjectSetup[] {
    return this.#db
      .prepare(
        "SELECT setup FROM project_setups ORDER BY (json_extract(setup, '$.status') = 'working') DESC, rowid DESC LIMIT 64",
      )
      .all()
      .reverse()
      .map((row) => ProjectSetupSchema.parse(JSON.parse(String(row["setup"]))));
  }
  reserveProjectSetup(request: ProjectRequest, setup: ProjectSetup): boolean {
    const prior = this.#db
      .prepare(
        "SELECT request FROM project_setups WHERE id = ? OR json_extract(request, '$.requestId') = ?",
      )
      .get(setup.id, request.requestId);
    if (prior) {
      if (prior["request"] !== JSON.stringify(request))
        throw new Error("Project setup ID already used with different parameters");
      return false;
    }
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
      if (
        (!op.recover && project.version !== op.expectedVersion) ||
        pane.sessionId !== op.expectedSessionId
      )
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
      if (session.terminalProfile) pane.terminalProfile = session.terminalProfile;
      else delete pane.terminalProfile;
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

  agents(): AgentInfo[] {
    return this.#db
      .prepare("SELECT info FROM agents ORDER BY rowid")
      .all()
      .map((row) => AgentInfoSchema.parse(JSON.parse(String(row["info"]))));
  }
  agent(id: string): AgentInfo {
    const row = this.#db.prepare("SELECT info FROM agents WHERE id = ?").get(id);
    if (!row) throw new Error("Agent session no longer exists");
    return AgentInfoSchema.parse(JSON.parse(String(row["info"])));
  }
  saveAgent(info: AgentInfo): void {
    this.#db
      .prepare("UPDATE agents SET info = ? WHERE id = ?")
      .run(JSON.stringify(AgentInfoSchema.parse(info)), info.id);
  }
  agentReceipt(request: AgentRequest): string | null {
    const row = this.#db
      .prepare("SELECT request, session_id FROM agent_requests WHERE id = ?")
      .get(request.requestId);
    if (!row) return null;
    if (row["request"] !== JSON.stringify(request))
      throw new Error("Request ID already used with different parameters");
    return String(row["session_id"]);
  }
  reserveAgentAction(request: AgentRequest, info: AgentInfo): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare("INSERT INTO agent_requests (id, request, session_id) VALUES (?, ?, ?)")
        .run(request.requestId, JSON.stringify(request), info.id);
      this.saveAgent(info);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  reserveAgent(request: AgentRequest, info: AgentInfo): void {
    const op = request.operation;
    if (op.kind !== "start") throw new Error("Expected agent start");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.snapshot();
      const project = state.projects.find((p) => p.id === op.projectId);
      const pane = project?.tabs
        .find((t) => t.id === op.tabId)
        ?.nodes.find((n) => n.id === op.paneId);
      if (state.epoch !== op.epoch || project?.version !== op.expectedVersion)
        throw new Error("Workspace changed; refresh before starting");
      if (!pane || pane.kind !== "pane" || pane.profile !== "chat" || pane.sessionId !== null)
        throw new Error("Select an empty chat pane");
      if (this.agents().length >= 128) throw new Error("Agent session limit reached (128)");
      pane.sessionId = info.id;
      project.version++;
      state.revision++;
      this.#db
        .prepare("INSERT INTO agents (id, info) VALUES (?, ?)")
        .run(info.id, JSON.stringify(info));
      this.#db
        .prepare("INSERT INTO agent_requests (id, request, session_id) VALUES (?, ?, ?)")
        .run(request.requestId, JSON.stringify(request), info.id);
      this.#db.prepare("UPDATE workspace SET snapshot = ? WHERE id = 1").run(JSON.stringify(state));
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  agentItem(sessionId: string, id: string): AgentItem | null {
    const row = this.#db
      .prepare("SELECT position, item FROM agent_items WHERE session_id = ? AND item_id = ?")
      .get(sessionId, id);
    return row
      ? AgentItemSchema.parse({
          ...JSON.parse(String(row["item"])),
          position: Number(row["position"]),
        })
      : null;
  }
  saveAgentItem(item: AgentItem): AgentItem {
    // Keep individual frames bounded, while retaining older items in the paginated history.
    const bound = (text: string, limit: number) =>
      text.length > limit ? text.slice(0, limit) + "\n[Display truncated]" : text;
    const value = AgentItemSchema.parse({
      ...item,
      revision: (this.agentItem(item.sessionId, item.id)?.revision ?? -1) + 1,
      text: bound(item.text, 16000),
      detail: bound(item.detail, 16000),
      title: bound(item.title, 240),
    });
    this.#db
      .prepare(
        "INSERT INTO agent_items (session_id, item_id, item) VALUES (?, ?, ?) ON CONFLICT(session_id, item_id) DO UPDATE SET item=excluded.item",
      )
      .run(item.sessionId, item.id, JSON.stringify(value));
    const saved = this.agentItem(item.sessionId, item.id);
    if (!saved) throw new Error("Agent item was not saved");
    return saved;
  }
  agentTurnItems(sessionId: string, turnId: string): AgentItem[] {
    return this.#db
      .prepare(
        "SELECT position, item FROM agent_items WHERE session_id = ? AND json_extract(item, '$.turnId') = ? ORDER BY position",
      )
      .all(sessionId, turnId)
      .map((row) =>
        AgentItemSchema.parse({
          ...JSON.parse(String(row["item"])),
          position: Number(row["position"]),
        }),
      );
  }
  agentConversation(id: string, before = Number.MAX_SAFE_INTEGER): AgentConversation {
    const rows = this.#db
      .prepare(
        "SELECT position, item FROM agent_items WHERE session_id = ? AND position < ? ORDER BY position DESC LIMIT 80",
      )
      .all(id, before);
    const items: AgentItem[] = [];
    let bytes = 0;
    for (const row of rows) {
      const item = AgentItemSchema.parse({
        ...JSON.parse(String(row["item"])),
        position: Number(row["position"]),
      });
      bytes += Buffer.byteLength(JSON.stringify(item));
      if (bytes > 384 * 1024 && items.length) break;
      items.unshift(item);
    }
    const first = items[0]?.position;
    const hasMore =
      first !== undefined &&
      !!this.#db
        .prepare("SELECT 1 FROM agent_items WHERE session_id = ? AND position < ? LIMIT 1")
        .get(id, first);
    return { agent: this.agent(id), items, hasMore };
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
