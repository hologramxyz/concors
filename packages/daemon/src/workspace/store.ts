import { realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { z } from "zod";
import {
  AgentAttachmentSchema,
  AgentInfoSchema,
  AgentItemSchema,
  AgentSettingsSchema,
  AgentUploadSchema,
  type AgentAttachment,
  type AgentUpload,
  type AgentInfo,
  type AgentSettings,
  type AgentItem,
  type AgentRequest,
  type AgentConversation,
  type RetiredAgent,
  AGENT_SESSION_LIMIT,
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
  folderName,
  isDefaultTabName,
  nextWorkspaceTabName,
  WorkspaceOperationError,
  WorkspaceProjectSchema,
  WorkspaceSnapshotSchema,
  WorkspaceResultSchema,
  type ClosedProject,
  type WorkspaceCommand,
  type WorkspaceProject,
  type WorkspaceResult,
  type WorkspaceSnapshot,
} from "@concors/protocol";

/**
 * How many chat sessions a machine keeps. Every session is replayed to each client that connects,
 * so the number is bounded; when it is reached, the least recently used closed chat makes room.
 */
export { AGENT_SESSION_LIMIT };
/** How many closed workspaces a machine keeps; closing one more forgets the oldest. */
const CLOSED_PROJECT_LIMIT = 64;
/** When the most recently used of these chats was last used. */
const newest = (chats: readonly AgentInfo[]) =>
  chats.reduce((time, chat) => (chat.updatedAt > time ? chat.updatedAt : time), "");
const ACTIVE_AGENT = ["starting", "working", "needs_input"];
/** A kept file: its bytes, for inline attachments and shown images, or an upload's reference. */
const StoredFileSchema = z.union([AgentAttachmentSchema, AgentUploadSchema]);

/** A single daemon owns this database. Layout and retry receipts commit atomically. */
export class WorkspaceStore {
  readonly #db: DatabaseSync;
  readonly attachmentsDirectory: string;
  #closed = false;
  readonly #kept: (() => Iterable<string>)[] = [];
  /** Told which sessions were removed to make room, once they are gone (see makeRoomForAgent). */
  onAgentsRetired: ((agents: RetiredAgent[]) => void) | null = null;
  /** Told of chats moved into a workspace whose folder was opened (see adoptChats). */
  onAgentsMoved: ((agents: AgentInfo[]) => void) | null = null;
  /** The home folder, where every one-click workspace starts, so no workspace opened there adopts chats. */
  home = (() => {
    try {
      return realpathSync(homedir());
    } catch {
      return homedir();
    }
  })();

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
        CREATE TABLE IF NOT EXISTS closed_projects (id TEXT PRIMARY KEY, directory TEXT NOT NULL, project TEXT NOT NULL, closed_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS project_setups (id TEXT PRIMARY KEY, request TEXT NOT NULL, setup TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, info TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_items (position INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, item_id TEXT NOT NULL, item TEXT NOT NULL, UNIQUE(session_id, item_id));
        CREATE INDEX IF NOT EXISTS agent_message_index ON agent_items (session_id, position) WHERE json_extract(item, '$.kind') = 'user';
        CREATE INDEX IF NOT EXISTS agent_background_index ON agent_items (session_id) WHERE json_extract(item, '$.presentation.background') = 1;
        CREATE TABLE IF NOT EXISTS agent_native_turns (session_id TEXT NOT NULL, native_id TEXT NOT NULL, turn_id TEXT NOT NULL, PRIMARY KEY (session_id, native_id));
        CREATE TABLE IF NOT EXISTS agent_request_errors (id TEXT PRIMARY KEY, message TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_queue (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, request TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_requests (id TEXT PRIMARY KEY, request TEXT NOT NULL, session_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_item_images (session_id TEXT NOT NULL, item_id TEXT NOT NULL, position INTEGER NOT NULL, attachment TEXT NOT NULL, PRIMARY KEY (session_id, item_id, position));
        CREATE TABLE IF NOT EXISTS agent_defaults (provider TEXT PRIMARY KEY, settings TEXT NOT NULL, used_at INTEGER NOT NULL);
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
      this.#closeStrandedChats();
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
      let moved: AgentInfo[] = [];
      // Closing and reopening write tables of their own, undone with the operation if it fails.
      this.#db.exec("SAVEPOINT operation");
      try {
        if (command.epoch !== current.epoch)
          throw new WorkspaceOperationError(
            "CONFLICT",
            "Workspace was replaced. Refresh before editing.",
          );
        const op = command.operation;
        snapshot =
          op.kind === "project.reopen"
            ? this.#reopenProject(current, op.projectId)
            : applyWorkspaceOperation(current, op);
        if (op.kind === "project.close") {
          const closed = current.projects.find((project) => project.id === op.projectId);
          if (closed) this.#keepClosedProject({ ...closed, version: closed.version + 1 });
        }
        if (op.kind === "project.close" || op.kind === "project.reopen")
          snapshot.closedProjects = this.#closedProjects();
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
        const opened =
          op.kind === "project.reopen" ||
          (op.kind === "project.add" && op.directoryMode !== "follow")
            ? snapshot.projects.find((project) => project.id === op.projectId)
            : undefined;
        if (opened) moved = this.#adoptChats(snapshot, opened);
        this.#db.exec("RELEASE operation");
        result = {
          type: "workspace.result",
          commandId: command.commandId,
          outcome: { status: "accepted", revision: snapshot.revision },
        };
      } catch (error) {
        this.#db.exec("ROLLBACK TO operation");
        this.#db.exec("RELEASE operation");
        if (!(error instanceof WorkspaceOperationError)) throw error;
        snapshot = current;
        moved = [];
        result = this.reject(command, error.code, error.message);
      }
      this.#db
        .prepare("INSERT INTO commands (id, payload, result) VALUES (?, ?, ?)")
        .run(command.commandId, payload, JSON.stringify(result));
      this.#db.exec("COMMIT");
      // After the snapshot that lists their workspace has gone out.
      if (moved.length)
        queueMicrotask(() => {
          if (!this.#closed) this.onAgentsMoved?.(moved);
        });
      return { result, snapshot, changed: result.outcome.status === "accepted" };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Closed workspaces, newest first, as clients list them. */
  #closedProjects(): ClosedProject[] {
    return this.#db
      .prepare("SELECT project, closed_at FROM closed_projects ORDER BY closed_at DESC, rowid DESC")
      .all()
      .map((row) => {
        const project = WorkspaceProjectSchema.parse(JSON.parse(String(row["project"])));
        return {
          id: project.id,
          name: project.name,
          directory: project.directory,
          closedAt: String(row["closed_at"]),
        };
      });
  }

  /** The most recently closed workspace on this folder, which opening it brings back. */
  closedProjectAt(directory: string): string | null {
    const row = this.#db
      .prepare(
        "SELECT id FROM closed_projects WHERE directory = ? ORDER BY closed_at DESC, rowid DESC LIMIT 1",
      )
      .get(directory);
    return row ? String(row["id"]) : null;
  }

  /**
   * Keeps a closed workspace whole, tabs and all, with the folders it has used. Several can share
   * a folder, as one-click workspaces in the home folder do. Past the limit the oldest is
   * forgotten; its chats stay, and join a workspace opened on their folder (see adoptChats).
   */
  #keepClosedProject(project: WorkspaceProject, closedAt = new Date().toISOString()): void {
    const forget = (id: string) => {
      this.#db.prepare("DELETE FROM closed_projects WHERE id = ?").run(id);
      this.#db.prepare("DELETE FROM project_directories WHERE project_id = ?").run(id);
    };
    this.#db
      .prepare(
        "INSERT OR REPLACE INTO closed_projects (id, directory, project, closed_at) VALUES (?, ?, ?, ?)",
      )
      .run(project.id, project.directory, JSON.stringify(project), closedAt);
    for (const row of this.#db
      .prepare(
        "SELECT id FROM closed_projects ORDER BY closed_at DESC, rowid DESC LIMIT -1 OFFSET ?",
      )
      .all(CLOSED_PROJECT_LIMIT))
      forget(String(row["id"]));
  }

  /**
   * The workspace with a closed one back in it, selected at its first tab. It comes back by its ID
   * even when another workspace has since opened its folder. A pane whose chat or
   * terminal has since gone (deleted, or removed to make room) opens to the start screen instead.
   */
  #reopenProject(current: WorkspaceSnapshot, id: string): WorkspaceSnapshot {
    const row = this.#db.prepare("SELECT project FROM closed_projects WHERE id = ?").get(id);
    if (!row) throw new WorkspaceOperationError("NOT_FOUND", "Workspace no longer exists");
    const project = WorkspaceProjectSchema.parse(JSON.parse(String(row["project"])));
    if (current.projects.length >= 64)
      throw new WorkspaceOperationError("LIMIT_EXCEEDED", "Maximum of 64 workspaces reached");
    const sessions = new Set([
      ...this.agents().map((agent) => agent.id),
      ...this.terminals().map((terminal) => terminal.id),
    ]);
    for (const node of project.tabs.flatMap((tab) => tab.nodes))
      if (node.kind === "pane" && node.sessionId && !sessions.has(node.sessionId))
        node.sessionId = null;
    this.#db.prepare("DELETE FROM closed_projects WHERE id = ?").run(id);
    const state = WorkspaceSnapshotSchema.parse(current);
    state.projects.push({ ...project, version: project.version + 1 });
    state.selection = { projectId: project.id, tabId: project.tabs[0]?.id ?? null };
    state.revision++;
    return WorkspaceSnapshotSchema.parse(state);
  }

  /**
   * Once, for chats left without a workspace by daemons that removed workspaces instead of closing
   * them: each folder's chats become a closed workspace, listed with the others to reopen, closed
   * when its newest chat was last used.
   */
  #closeStrandedChats(): void {
    if (this.#db.prepare("SELECT 1 FROM migrations WHERE name = 'stranded-chats'").get()) return;
    this.transaction(() => {
      const state = this.snapshot();
      const known = new Set([
        ...state.projects.map((item) => item.id),
        ...this.#closedProjects().map((item) => item.id),
      ]);
      const folders = new Map<string, AgentInfo[]>();
      for (const agent of this.agents())
        if (!known.has(agent.projectId))
          folders.set(agent.directory, [...(folders.get(agent.directory) ?? []), agent]);
      for (const [directory, chats] of [...folders].sort(([, a], [, b]) =>
        newest(a).localeCompare(newest(b)),
      )) {
        const project: WorkspaceProject = {
          id: randomUUID(),
          name: folderName(directory),
          directory,
          version: 0,
          tabs: [],
        };
        this.#keepClosedProject(project, newest(chats));
        for (const agent of chats)
          this.saveAgent({ ...agent, projectId: project.id, revision: agent.revision + 1 });
      }
      if (folders.size) {
        state.closedProjects = this.#closedProjects();
        state.revision++;
        this.#db
          .prepare("UPDATE workspace SET snapshot = ? WHERE id = 1")
          .run(JSON.stringify(state));
      }
      this.#db.prepare("INSERT INTO migrations (name) VALUES ('stranded-chats')").run();
    });
  }

  /** Opening the folder of a workspace already open brings in its stranded chats too. */
  adoptChats(projectId: string): void {
    const state = this.snapshot();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project || project.directoryMode === "follow") return;
    const moved = this.transaction(() => this.#adoptChats(state, project));
    if (moved.length) this.onAgentsMoved?.(moved);
  }

  /**
   * Moves chats whose workspace is gone, neither open nor closed, into a workspace just opened on
   * their own folder; never one in the home folder. Older clients still remove workspaces.
   */
  #adoptChats(state: WorkspaceSnapshot, project: WorkspaceProject): AgentInfo[] {
    if (project.directory === this.home) return [];
    const known = new Set([
      ...state.projects.map((item) => item.id),
      ...this.#closedProjects().map((item) => item.id),
    ]);
    const moved: AgentInfo[] = [];
    for (const agent of this.agents()) {
      if (known.has(agent.projectId) || agent.directory !== project.directory) continue;
      const next = { ...agent, projectId: project.id, revision: agent.revision + 1 };
      this.saveAgent(next);
      moved.push(next);
    }
    return moved;
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
        // A name the user chose outlives the move; the icon still follows `directory`.
        if (!project.renamed) project.name = folderName(root);
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

  /**
   * Reserve the launch and bind its pane before spawning, so crashes never duplicate a launch.
   *
   * Showing a newly started session in its pane leaves the project's version alone, as selection
   * does. Every new pane starts its session on its own a moment after it appears, so counting that
   * as an edit made the next layout command, built from the snapshot just before, fail as changed
   * on another client: closing or renaming a tab right after splitting a pane did nothing. Two
   * starts for one pane still exclude each other through the pane's session ID.
   */
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
      let state = this.snapshot();
      const session = this.terminal(op.sessionId);
      if (session.projectId !== op.projectId) throw new Error("Session belongs to another project");
      // Opening it in a tab of its own creates that tab here, so nobody sees it empty first.
      if (op.newTab) {
        state = applyWorkspaceOperation(state, {
          kind: "tab.create",
          projectId: op.projectId,
          expectedVersion: op.expectedVersion,
          tabId: op.tabId,
          paneId: op.paneId,
          name: op.newTab.name,
          profile: session.profile,
        });
      }
      const project = state.projects.find((p) => p.id === op.projectId);
      const pane = project?.tabs
        .find((t) => t.id === op.tabId)
        ?.nodes.find((n) => n.id === op.paneId);
      if (!project || !pane || pane.kind !== "pane") throw new Error("Pane no longer exists");
      if (pane.sessionId === session.id) {
        this.#db.exec("COMMIT");
        return;
      }
      // A new tab was checked against the version as it was created, and already counted.
      if (!op.newTab && (project.version !== op.expectedVersion || pane.sessionId !== null))
        throw new Error("Use an empty pane to attach this session");
      if (op.newTab) pane.directory = session.directory;
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
      if (!op.newTab) {
        project.version++;
        state.revision++;
      }
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
  /** Sessions something else still relies on although no pane shows them, such as a schedule's. */
  keepAgents(ids: () => Iterable<string>): void {
    this.#kept.push(ids);
  }
  /** The sessions some pane shows. */
  #shownAgents(state: WorkspaceSnapshot = this.snapshot()): Set<string> {
    return new Set(
      state.projects.flatMap((project) =>
        project.tabs.flatMap((tab) =>
          tab.nodes.flatMap((node) =>
            node.kind === "pane" && node.sessionId ? [node.sessionId] : [],
          ),
        ),
      ),
    );
  }
  /** Whether something other than a pane relies on the session, such as a schedule. */
  keepsAgent(id: string): boolean {
    return this.#kept.some((ids) => [...ids()].includes(id));
  }
  /**
   * Frees a place for one more session by removing the least recently updated closed chats.
   * A chat is closed when no pane shows it, it is not running or waiting for an answer, nothing is
   * queued for it, and nothing keeps it (keepAgents). Pinned chats are never removed. Its
   * conversation, images and attachment files go with it; for Claude Code and Codex the provider's
   * own history usually remains, so Resume session can still find it. Throws only when every
   * session is open, active or pinned.
   */
  makeRoomForAgent(state: WorkspaceSnapshot = this.snapshot()): void {
    const agents = this.agents();
    const excess = agents.length - (AGENT_SESSION_LIMIT - 1);
    if (excess <= 0) return;
    const shown = this.#shownAgents(state);
    const kept = new Set(this.#kept.flatMap((ids) => [...ids()]));
    const queued = new Set(
      this.#db
        .prepare("SELECT DISTINCT session_id FROM agent_queue")
        .all()
        .map((row) => String(row["session_id"])),
    );
    const retired = agents
      .filter(
        (agent) =>
          !shown.has(agent.id) &&
          !kept.has(agent.id) &&
          !queued.has(agent.id) &&
          !agent.pinned &&
          !ACTIVE_AGENT.includes(agent.status) &&
          agent.pending.length === 0 &&
          !agent.queue?.length,
      )
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, excess);
    if (retired.length < excess)
      throw new Error(
        `All ${AGENT_SESSION_LIMIT} chats on this machine are open, active or pinned. Close or unpin one to start another.`,
      );
    this.#deleteAgentRows(retired.map((agent) => agent.id));
    // Callers start the new chat in a transaction of their own. Files and notices wait until it
    // has settled, and only for chats really gone: a start that rolled back keeps its old chats.
    queueMicrotask(() => {
      if (this.#closed) return;
      const gone = retired.filter(
        (agent) => !this.#db.prepare("SELECT 1 FROM agents WHERE id = ?").get(agent.id),
      );
      if (gone.length === 0) return;
      for (const agent of gone) this.#deleteAgentFiles(agent.id);
      this.onAgentsRetired?.(
        gone.map((agent) => ({
          id: agent.id,
          projectId: agent.projectId,
          name: (agent.paneName ?? agent.tabName ?? agent.name).slice(0, 200),
        })),
      );
    });
  }
  /**
   * Deletes a chat with its conversation, images and attachment files. Only a chat no pane shows
   * and nothing keeps can go, so a tab never points at a deleted chat.
   */
  deleteAgent(id: string): void {
    this.agent(id);
    if (this.#shownAgents().has(id)) throw new Error("Close this chat before deleting it");
    if (this.keepsAgent(id)) throw new Error("A schedule uses this chat. Remove it first.");
    this.#deleteAgentRows([id]);
    this.#deleteAgentFiles(id);
  }
  #deleteAgentRows(ids: readonly string[]): void {
    this.transaction(() => {
      for (const id of ids)
        for (const table of [
          "agent_items",
          "agent_item_images",
          "agent_native_turns",
          "agent_queue",
          "agent_requests",
        ])
          this.#db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(id);
      for (const id of ids) this.#db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    });
  }
  #deleteAgentFiles(id: string): void {
    rmSync(join(this.attachmentsDirectory, id), { recursive: true, force: true });
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
    this.#db
      .prepare(
        "DELETE FROM agent_item_images WHERE session_id = ? AND item_id NOT IN (SELECT item_id FROM agent_items WHERE session_id = ?)",
      )
      .run(sessionId, sessionId);
  }
  nativeTurn(sessionId: string, nativeId: string): string {
    const row = this.#db
      .prepare("SELECT turn_id FROM agent_native_turns WHERE session_id = ? AND native_id = ?")
      .get(sessionId, nativeId);
    return row ? String(row["turn_id"]) : nativeId;
  }
  /** The settings last chosen for a provider on this machine, if any are still readable. */
  agentDefaults(provider: string): AgentSettings | null {
    const row = this.#db
      .prepare("SELECT settings FROM agent_defaults WHERE provider = ?")
      .get(provider);
    if (!row) return null;
    const parsed = AgentSettingsSchema.safeParse(JSON.parse(String(row["settings"])));
    return parsed.success ? parsed.data : null;
  }
  /** Providers by most recent choice, newest first. */
  agentDefaultProviders(): string[] {
    return this.#db
      .prepare("SELECT provider FROM agent_defaults ORDER BY used_at DESC, rowid DESC")
      .all()
      .map((row) => String(row["provider"]));
  }
  saveAgentDefaults(provider: string, settings: AgentSettings): void {
    this.#db
      .prepare(
        "INSERT INTO agent_defaults (provider, settings, used_at) VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET settings = excluded.settings, used_at = excluded.used_at",
      )
      .run(provider, JSON.stringify(AgentSettingsSchema.parse(settings)), Date.now());
  }

  createBackgroundAgent(info: AgentInfo): void {
    if (!this.snapshot().projects.some((p) => p.id === info.projectId))
      throw new Error("Project no longer exists");
    this.makeRoomForAgent();
    this.#db
      .prepare("INSERT INTO agents (id,info) VALUES (?,?)")
      .run(info.id, JSON.stringify(AgentInfoSchema.parse(info)));
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
      const tab = project?.tabs.find((tab) =>
        tab.nodes.some(
          (pane) =>
            pane.kind === "pane" && pane.profile === "chat" && pane.sessionId === previous.id,
        ),
      );
      const bound = tab?.nodes.find(
        (pane) => pane.kind === "pane" && pane.profile === "chat" && pane.sessionId === previous.id,
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
      // A session that already has a chat comes back as that chat, even mid-turn: closing a tab
      // leaves its turn running, and this only shows it again, without starting another CLI.
      if (existing) info = existing;
      if (!existingBound) {
        if (!existing) this.makeRoomForAgent(state);
        bound.sessionId = info.id;
        // A chat resumed from its session comes back under the names it was given, unless this
        // pane or tab was named since. Without this the next workspace edit forgot them.
        if (existing?.paneName && !bound.name) bound.name = existing.paneName;
        if (
          existing?.tabName &&
          tab &&
          isDefaultTabName(tab.name) &&
          tab.nodes.filter((node) => node.kind === "pane").length === 1
        )
          tab.name = existing.tabName;
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
  /** Bring a saved/background agent into a tab without changing or restarting its turn. */
  openAgent(request: AgentRequest): void {
    if (request.operation.kind !== "open-session") throw new Error("Expected open session");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const info = this.agent(request.operation.sessionId);
      let state = this.snapshot();
      const project = state.projects.find((p) => p.id === info.projectId);
      if (!project) throw new Error("The agent's workspace is unavailable");
      if (
        !project.tabs.some((tab) =>
          tab.nodes.some((node) => node.kind === "pane" && node.sessionId === info.id),
        )
      ) {
        const tabId = randomUUID(),
          paneId = randomUUID();
        state = applyWorkspaceOperation(state, {
          kind: "tab.create",
          projectId: project.id,
          expectedVersion: project.version,
          tabId,
          paneId,
          name: info.tabName ?? nextWorkspaceTabName(project.tabs),
          profile: "chat",
        });
        const pane = state.projects
          .find((p) => p.id === project.id)
          ?.tabs.find((t) => t.id === tabId)
          ?.nodes.find((n) => n.id === paneId);
        if (!pane || pane.kind !== "pane") throw new Error("Could not open agent tab");
        pane.sessionId = info.id;
        pane.directory = info.directory;
        // A closed chat comes back under the names it was given.
        if (info.paneName) pane.name = info.paneName;
        this.#db.prepare("UPDATE workspace SET snapshot=? WHERE id=1").run(JSON.stringify(state));
      }
      this.#db
        .prepare("INSERT INTO agent_requests (id,request,session_id) VALUES (?,?,?)")
        .run(request.requestId, JSON.stringify(request), info.id);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  /** Shows a new agent in the pane that showed `previous`, which is kept, no longer shown. */
  replaceAgentInPane(
    request: AgentRequest,
    previous: AgentInfo,
    info: AgentInfo,
    /** The queued message this request delivers, which is done with once it runs. */
    queued?: string,
  ): AgentInfo {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.snapshot();
      const project = state.projects.find((p) => p.id === previous.projectId);
      const pane = project?.tabs
        .flatMap((tab) => tab.nodes)
        .find(
          (node) =>
            node.kind === "pane" && node.profile === "chat" && node.sessionId === previous.id,
        );
      if (!project || !pane || pane.kind !== "pane")
        throw new Error("This agent's pane has been closed or changed.");
      this.makeRoomForAgent(state);
      // Not a layout edit; see reserveTerminal.
      pane.sessionId = info.id;
      state.revision++;
      this.#db
        .prepare("INSERT INTO agents (id, info) VALUES (?, ?)")
        .run(info.id, JSON.stringify(AgentInfoSchema.parse(info)));
      this.#db
        .prepare("INSERT INTO agent_requests (id, request, session_id) VALUES (?, ?, ?)")
        .run(request.requestId, JSON.stringify(request), info.id);
      if (queued)
        this.#db
          .prepare("DELETE FROM agent_queue WHERE id = ? AND session_id = ?")
          .run(queued, previous.id);
      this.#db.prepare("UPDATE workspace SET snapshot = ? WHERE id = 1").run(JSON.stringify(state));
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
      if (!restoring) this.makeRoomForAgent(state);
      // Not a layout edit; see reserveTerminal. An imported or forked chat's new tab already
      // counted as one.
      pane.sessionId = info.id;
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
  /** Background sub-agent rows still marked running; after a restart nothing reports to them. */
  runningBackgroundItems(): AgentItem[] {
    return this.#db
      .prepare(
        "SELECT position, item FROM agent_items WHERE json_extract(item, '$.presentation.background') = 1 AND json_extract(item, '$.status') = 'running'",
      )
      .all()
      .map((row) =>
        AgentItemSchema.parse({
          ...JSON.parse(String(row["item"])),
          position: Number(row["position"]),
        }),
      );
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
  /**
   * Runs `work` in one transaction, or inside the one already open. Each commit waits for the
   * disk, so a batch of writes (a replayed history) commits once instead of once per write.
   */
  transaction<T>(work: () => T): T {
    if (this.#db.isTransaction) return work();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  /**
   * Keeps the images an agent showed in a message, or the files sent with a steering message,
   * replacing any kept for it before. Uploaded files are kept as references: their bytes stay on
   * disk, in the chat's own directory.
   */
  saveAgentItemImages(
    sessionId: string,
    itemId: string,
    images: readonly (AgentAttachment | AgentUpload)[],
  ) {
    this.transaction(() => {
      this.#db
        .prepare("DELETE FROM agent_item_images WHERE session_id = ? AND item_id = ?")
        .run(sessionId, itemId);
      const insert = this.#db.prepare(
        "INSERT INTO agent_item_images (session_id, item_id, position, attachment) VALUES (?, ?, ?, ?)",
      );
      images.forEach((image, index) =>
        insert.run(sessionId, itemId, index, JSON.stringify(StoredFileSchema.parse(image))),
      );
    });
  }
  /** A message's file by position: inline ones come first, then uploaded ones, as they were sent. */
  agentAttachment(sessionId: string, itemId: string, index: number): AgentAttachment | AgentUpload {
    if (!this.agentItem(sessionId, itemId)) throw new Error("Attachment is unavailable");
    if (!itemId.startsWith("prompt:")) {
      const image = this.#db
        .prepare(
          "SELECT attachment FROM agent_item_images WHERE session_id = ? AND item_id = ? AND position = ?",
        )
        .get(sessionId, itemId, index);
      if (!image) throw new Error("Attachment is unavailable");
      return StoredFileSchema.parse(JSON.parse(String(image["attachment"])));
    }
    const row = this.#db
      .prepare("SELECT request FROM agent_requests WHERE id = ? AND session_id = ?")
      .get(itemId.slice(7), sessionId);
    const request = row ? (JSON.parse(String(row["request"])) as AgentRequest) : undefined;
    const op = request?.operation;
    const file =
      op?.kind === "send" ? [...(op.attachments ?? []), ...(op.uploads ?? [])][index] : undefined;
    if (!file) throw new Error("Attachment is unavailable");
    return StoredFileSchema.parse(file);
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
  hasAgentTurnPrompt(sessionId: string, turnId: string): boolean {
    // A long turn pushes its prompt out of the latest page, so look across the whole session.
    return !!this.#db
      .prepare(
        "SELECT 1 FROM agent_items WHERE session_id = ? AND json_extract(item, '$.kind') = 'user' AND json_extract(item, '$.turnId') = ? LIMIT 1",
      )
      .get(sessionId, turnId);
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
