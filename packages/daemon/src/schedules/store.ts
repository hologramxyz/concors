import { DatabaseSync } from "node:sqlite";
import {
  AgentScheduleSchema,
  ScheduleResultSchema,
  type AgentSchedule,
  type ScheduleRequest,
  type ScheduleResult,
} from "@concors/protocol";

/** Kept beside workspace.sqlite, inside the account's runtime partition. */
export class ScheduleStore {
  private readonly db: DatabaseSync;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL);`);
    this.list();
  }
  list(): AgentSchedule[] {
    return this.db
      .prepare("SELECT value FROM schedules ORDER BY rowid DESC")
      .all()
      .map((row) => AgentScheduleSchema.parse(JSON.parse(String(row.value))));
  }
  save(value: AgentSchedule): void {
    this.db
      .prepare(
        "INSERT INTO schedules (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(value.id, JSON.stringify(AgentScheduleSchema.parse(value)));
  }
  remove(id: string): void {
    this.db.prepare("DELETE FROM schedules WHERE id=?").run(id);
  }
  receipt(request: ScheduleRequest): ScheduleResult | undefined {
    const row = this.db
      .prepare("SELECT request,result FROM receipts WHERE id=?")
      .get(request.requestId);
    if (!row) return;
    if (row.request !== JSON.stringify(request))
      throw new Error("Request ID was already used for a different schedule change");
    return ScheduleResultSchema.parse(JSON.parse(String(row.result)));
  }
  /** Mutation, due-time claim and retry receipt are one commit. Never dispatch before it. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  remember(request: ScheduleRequest, result: ScheduleResult): void {
    this.db
      .prepare("INSERT INTO receipts (id,request,result) VALUES (?,?,?)")
      .run(request.requestId, JSON.stringify(request), JSON.stringify(result));
    this.db.exec(
      "DELETE FROM receipts WHERE rowid NOT IN (SELECT rowid FROM receipts ORDER BY rowid DESC LIMIT 2048)",
    );
  }
  close(): void {
    this.db.close();
  }
}
