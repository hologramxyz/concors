import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
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
      if (version !== 0 && version !== 1)
        throw new Error(`Unsupported workspace database version: ${String(version)}`);
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
        PRAGMA user_version = 1;
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
