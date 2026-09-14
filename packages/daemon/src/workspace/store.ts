import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  AgentAttachmentSchema,
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
  nextWorkspaceTabName,
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
        CREATE INDEX IF NOT EXISTS agent_message_index ON agent_items (session_id, position) WHERE json_extract(item, '$.kind') = 'user';
        CREATE TABLE IF NOT EXISTS agent_native_turns (session_id TEXT NOT NULL, native_id TEXT NOT NULL, turn_id TEXT NOT NULL, PRIMARY KEY (session_id, native_id));
        CREATE TABLE IF NOT EXISTS agent_request_errors (id TEXT PRIMARY KEY, message TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_queue (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, request TEXT NOT NULL);
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
  mapNativeTurn(sessionId: string, nativeId: string, turnId: string): void {
    this.#db
      .prepare(
        "INSERT INTO agent_native_turns (session_id, native_id, turn_id) VALUES (?, ?, ?) ON CONFLICT(session_id, native_id) DO NOTHING",
      )
      .run(sessionId, nativeId, turnId);
  }
  nativeTurnId(sessionId: string, turnId: string): string {
    const row = this.#db
      .prepare(
        "SELECT native_id FROM agent_native_turns WHERE session_id = ? AND turn_id = ? LIMIT 1",
      )
      .get(sessionId, turnId);
    return row ? String(row["native_id"]) : turnId;
  }
  agentPrompts(sessionId: string): AgentItem[] {
    return this.#db
      .prepare("SELECT position, item FROM agent_items WHERE session_id = ? ORDER BY position")
      .all(sessionId)
      .map((row) =>
        AgentItemSchema.parse({
          ...JSON.parse(String(row["item"])),
          position: Number(row["position"]),
        }),
      )
      .filter((item) => item.kind === "user");
  }
  removeAgentTurnsFrom(sessionId: string, turnId: string) {
    const prompt = this.agentPrompts(sessionId).find((i) => i.turnId === turnId);
    if (!prompt) throw new Error("Turn is unavailable");
    this.#db
      .prepare("DELETE FROM agent_items WHERE session_id = ? AND position >= ?")
      .run(sessionId, prompt.position);
  }
  nativeTurn(sessionId: string, nativeId: string): string {
    const row = this.#db
      .prepare("SELECT turn_id FROM agent_native_turns WHERE session_id = ? AND native_id = ?")
      .get(sessionId, nativeId);
    return row ? String(row["turn_id"]) : nativeId;
  }
  saveAgent(info: AgentInfo): void {
    this.#db
      .prepare("UPDATE agents SET info = ? WHERE id = ?")
      .run(JSON.stringify(AgentInfoSchema.parse(info)), info.id);
  }
  agentActionError(id: string): string | null {
    const row = this.#db.prepare("SELECT message FROM agent_request_errors WHERE id = ?").get(id);
    return row ? String(row["message"]) : null;
  }
  saveAgentActionError(id: string, message: string): void {
    this.#db
      .prepare(
        "INSERT INTO agent_request_errors (id,message) VALUES (?,?) ON CONFLICT(id) DO NOTHING",
      )
      .run(id, message.slice(0, 4000));
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
  queuedRequest(id: string, sessionId: string): AgentRequest | null {
    const row = this.#db
      .prepare("SELECT request FROM agent_queue WHERE id = ? AND session_id = ?")
      .get(id, sessionId);
    return row ? (JSON.parse(String(row["request"])) as AgentRequest) : null;
  }
  reserveAgentAction(
    request: AgentRequest,
    info: AgentInfo,
    queue?: { add?: AgentRequest; remove?: string; resolution?: AgentItem },
  ): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.agent(info.id).providerGroupId &&
        !this.snapshot().projects.some((project) =>
          project.tabs.some((tab) =>
            tab.nodes.some((pane) => pane.kind === "pane" && pane.sessionId === info.id),
          ),
        )
      )
        throw new Error(
          "Switch back to this provider before sending messages or changing its conversation.",
        );
      this.#db
        .prepare("INSERT INTO agent_requests (id, request, session_id) VALUES (?, ?, ?)")
        .run(request.requestId, JSON.stringify(request), info.id);
      if (queue?.add)
        this.#db
          .prepare("INSERT INTO agent_queue (id, session_id, request) VALUES (?, ?, ?)")
          .run(request.requestId, info.id, JSON.stringify(queue.add));
      if (queue?.remove)
        this.#db
          .prepare("DELETE FROM agent_queue WHERE id = ? AND session_id = ?")
          .run(queue.remove, info.id);
      if (queue?.resolution) this.saveAgentItem(queue.resolution);
      this.saveAgent(info);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  /** Atomically reuse only a genuinely empty pane; an already bound session is just focused. */
  reserveResumedAgent(request: AgentRequest, info: AgentInfo): AgentInfo {
    const op = request.operation;
    if (op.kind !== "resume-session") throw new Error("Expected session resume");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.agent(op.sessionId);
      const state = this.snapshot();
      const project = state.projects.find((p) => p.id === previous.projectId);
      const bound = project?.tabs
        .flatMap((tab) => tab.nodes)
        .find(
          (pane) =>
            pane.kind === "pane" && pane.profile === "chat" && pane.sessionId === previous.id,
        );
      if (!project || !bound || bound.kind !== "pane" || previous.revision !== op.expectedRevision)
        throw new Error("The chat pane changed. Reopen Resume session and try again.");
      if (
        ["starting", "working", "needs_input"].includes(previous.status) ||
        previous.pending.length ||
        previous.queue?.length ||
        this.agentConversation(previous.id).items.length
      )
        throw new Error(
          "Resume sessions from an empty chat. Your current conversation has been kept.",
        );
      const existing = this.agents().find(
        (agent) => agent.provider === info.provider && agent.threadId === info.threadId,
      );
      const existingBound =
        existing &&
        state.projects.some((p) =>
          p.tabs.some((tab) =>
            tab.nodes.some((pane) => pane.kind === "pane" && pane.sessionId === existing.id),
          ),
        );
      if (
        existing &&
        (existing.projectId !== project.id || existing.directory !== previous.directory)
      )
        throw new Error("This session belongs to another workspace. Open it there.");
      if (
        existing &&
        !existingBound &&
        (["starting", "working", "needs_input"].includes(existing.status) ||
          existing.pending.length ||
          existing.queue?.length)
      )
        throw new Error("That session is still active. Finish it before resuming here.");
      if (existing) info = existing;
      if (!existingBound) {
        if (!existing && this.agents().length >= 128)
          throw new Error("Agent session limit reached (128)");
        bound.sessionId = info.id;
        this.saveAgent({ ...previous, revision: previous.revision + 1 });
        if (!existing)
          this.#db
            .prepare("INSERT INTO agents (id, info) VALUES (?, ?)")
            .run(info.id, JSON.stringify(info));
        project.version++;
        state.revision++;
        this.#db
          .prepare("UPDATE workspace SET snapshot = ? WHERE id = 1")
          .run(JSON.stringify(state));
      }
      this.#db
        .prepare("INSERT INTO agent_requests (id, request, session_id) VALUES (?, ?, ?)")
        .run(request.requestId, JSON.stringify(request), info.id);
      this.#db.exec("COMMIT");
      return info;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  reserveAgent(request: AgentRequest, info: AgentInfo): AgentInfo {
    const op = request.operation;
    if (
      op.kind !== "start" &&
      op.kind !== "switch-provider" &&
      op.kind !== "import-session" &&
      op.kind !== "fork-session"
    )
      throw new Error("Expected agent start");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      let state = this.snapshot();
      let project = state.projects.find((p) => p.id === info.projectId);
      let tabId: string, paneId: string;
      let restoring = false;
      if (op.kind !== "start") {
        const previous = this.agent(op.sessionId);
        if (
          previous.revision !== op.expectedRevision ||
          previous.projectId !== info.projectId ||
          !project
        )
          throw new Error("Agent changed. Try again.");
        if (op.kind === "switch-provider") {
          const bound = project.tabs
            .flatMap((tab) => tab.nodes.map((pane) => ({ tab, pane })))
            .find(
              ({ pane }) =>
                pane.kind === "pane" && pane.profile === "chat" && pane.sessionId === previous.id,
            );
          if (!bound) throw new Error("This agent's pane has been closed or changed.");
          const idle = (agent: AgentInfo) =>
            !["starting", "working", "needs_input"].includes(agent.status) &&
            !agent.pending.length &&
            !agent.queue?.length;
          if (!idle(previous))
            throw new Error(
              "Finish or stop this agent and clear queued messages before switching providers.",
            );
          tabId = bound.tab.id;
          paneId = bound.pane.id;
          const group = previous.providerGroupId ?? previous.id;
          const saved = this.agents().find(
            (agent) =>
              (agent.providerGroupId ?? agent.id) === group &&
              agent.provider === info.provider &&
              agent.projectId === info.projectId &&
              agent.directory === info.directory &&
              !!agent.threadId,
          );
          if (saved) {
            if (
              !idle(saved) ||
              state.projects.some((p) =>
                p.tabs.some((tab) =>
                  tab.nodes.some((pane) => pane.kind === "pane" && pane.sessionId === saved.id),
                ),
              )
            )
              throw new Error("That provider's conversation is already active in another pane.");
            restoring = true;
            info = {
              ...saved,
              ...(op.model && op.model !== saved.settings?.model
                ? {
                    model: op.model,
                    settings: {
                      ...(saved.settings ?? { mode: "default" as const }),
                      model: op.model,
                      effort: null,
                      serviceTier: null,
                      features: {},
                    },
                    revision: saved.revision + 1,
                  }
                : {}),
            };
          } else info = { ...info, providerGroupId: group };
          // Park the old conversation atomically with rebinding the pane. Late
          // commands from another client cannot start work in a hidden session.
          this.saveAgent({ ...previous, providerGroupId: group, revision: previous.revision + 1 });
        } else {
          tabId = randomUUID();
          paneId = randomUUID();
          state = applyWorkspaceOperation(state, {
            kind: "tab.create",
            projectId: project.id,
            expectedVersion: project.version,
            tabId,
            paneId,
            name: nextWorkspaceTabName(project.tabs),
            profile: "chat",
          });
          project = state.projects.find((p) => p.id === info.projectId);
        }
      } else {
        tabId = op.tabId;
        paneId = op.paneId;
        if (state.epoch !== op.epoch || project?.version !== op.expectedVersion)
          throw new Error("Workspace changed; refresh before starting");
      }
      const pane = project?.tabs.find((t) => t.id === tabId)?.nodes.find((n) => n.id === paneId);
      if (
        !project ||
        !pane ||
        pane.kind !== "pane" ||
        pane.profile !== "chat" ||
        pane.sessionId !== (op.kind === "switch-provider" ? op.sessionId : null)
      )
        throw new Error("Select an empty chat pane");
      if (!restoring && this.agents().length >= 128)
        throw new Error("Agent session limit reached (128)");
      pane.sessionId = info.id;
      project.version++;
      state.revision++;
      if (restoring) this.saveAgent(info);
      else
        this.#db
          .prepare("INSERT INTO agents (id, info) VALUES (?, ?)")
          .run(info.id, JSON.stringify(info));
      this.#db
        .prepare("INSERT INTO agent_requests (id, request, session_id) VALUES (?, ?, ?)")
        .run(request.requestId, JSON.stringify(request), info.id);
      this.#db.prepare("UPDATE workspace SET snapshot = ? WHERE id = 1").run(JSON.stringify(state));
      this.#db.exec("COMMIT");
      return info;
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
  agentAttachment(sessionId: string, itemId: string, index: number) {
    if (!this.agentItem(sessionId, itemId) || !itemId.startsWith("prompt:"))
      throw new Error("Attachment is unavailable");
    const row = this.#db
      .prepare("SELECT request FROM agent_requests WHERE id = ? AND session_id = ?")
      .get(itemId.slice(7), sessionId);
    const request = row ? (JSON.parse(String(row["request"])) as AgentRequest) : undefined;
    const op = request?.operation;
    if (op?.kind !== "send" || !op.attachments?.[index])
      throw new Error("Attachment is unavailable");
    return AgentAttachmentSchema.parse(op.attachments[index]);
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
  hasAgentProviderHistory(sessionId: string): boolean {
    // Check all history, not just the most recent page. Pending user prompts are reserved
    // locally before reaching a provider; every other item is evidence of provider activity.
    return !!this.#db
      .prepare(
        "SELECT 1 FROM agent_items WHERE session_id = ? AND (json_extract(item, '$.kind') != 'user' OR json_extract(item, '$.turnId') NOT LIKE 'pending:%') LIMIT 1",
      )
      .get(sessionId);
  }
  agentMessageIndex(id: string, before = Number.MAX_SAFE_INTEGER) {
    this.agent(id);
    const rows = this.#db
      .prepare(
        `SELECT position, json_extract(item, '$.id') AS id,
        substr(json_extract(item, '$.text'), 1, 240) AS preview,
        json_extract(item, '$.attachments[0].name') AS attachment
       FROM agent_items WHERE session_id = ? AND position < ?
       AND json_extract(item, '$.kind') = 'user' ORDER BY position DESC LIMIT 201`,
      )
      .all(id, before);
    return {
      messages: rows
        .slice(0, 200)
        .reverse()
        .map((row) => ({
          id: String(row["id"]),
          position: Number(row["position"]),
          preview: (
            String(row["preview"] ?? "")
              .replace(/\s+/g, " ")
              .trim() || String(row["attachment"] ?? "Attachment")
          ).slice(0, 240),
        })),
      hasMore: rows.length > 200,
    };
  }
  agentConversation(
    id: string,
    before = Number.MAX_SAFE_INTEGER,
    after?: number,
  ): AgentConversation {
    const rows = this.#db
      .prepare(
        after === undefined
          ? "SELECT position, item FROM agent_items WHERE session_id = ? AND position < ? ORDER BY position DESC LIMIT 80"
          : "SELECT position, item FROM agent_items WHERE session_id = ? AND position > ? ORDER BY position ASC LIMIT 80",
      )
      .all(id, after ?? before);
    const items: AgentItem[] = [];
    let bytes = 0;
    for (const row of rows) {
      const item = AgentItemSchema.parse({
        ...JSON.parse(String(row["item"])),
        position: Number(row["position"]),
      });
      bytes += Buffer.byteLength(JSON.stringify(item));
      if (bytes > 384 * 1024 && items.length) break;
      if (after === undefined) items.unshift(item);
      else items.push(item);
    }
    const first = items[0]?.position;
    const hasMore =
      first !== undefined &&
      !!this.#db
        .prepare("SELECT 1 FROM agent_items WHERE session_id = ? AND position < ? LIMIT 1")
        .get(id, first);
    const last = items.at(-1)?.position;
    const hasNewer =
      last !== undefined &&
      !!this.#db
        .prepare("SELECT 1 FROM agent_items WHERE session_id = ? AND position > ? LIMIT 1")
        .get(id, last);
    return { agent: this.agent(id), items, hasMore, hasNewer };
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
