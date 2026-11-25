import { DatabaseSync } from "node:sqlite";
import {
  AgentTriggerSchema,
  type AgentTrigger,
  type TriggerRequest,
  type TriggerResult,
} from "@concors/protocol";

/** Secrets never enter public snapshots or mutation receipts. */
export class TriggerStore {
  private readonly db: DatabaseSync;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS triggers (id TEXT PRIMARY KEY, value TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, request TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending (event_id TEXT PRIMARY KEY, trigger_id TEXT NOT NULL, session_id TEXT NOT NULL, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS event_targets (event_id TEXT PRIMARY KEY, trigger_id TEXT NOT NULL, target TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS keys (trigger_id TEXT NOT NULL, key TEXT NOT NULL, received_at TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(trigger_id,key));`);
  }
  list(): AgentTrigger[] {
    return this.db
      .prepare("SELECT value FROM triggers ORDER BY rowid DESC")
      .all()
      .map((r) => AgentTriggerSchema.parse(JSON.parse(String(r.value))));
  }
  save(trigger: AgentTrigger, hash?: string) {
    if (hash)
      this.db
        .prepare(
          "INSERT INTO triggers(id,value,hash) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,hash=excluded.hash",
        )
        .run(trigger.id, JSON.stringify(AgentTriggerSchema.parse(trigger)), hash);
    else
      this.db
        .prepare("UPDATE triggers SET value=? WHERE id=?")
        .run(JSON.stringify(AgentTriggerSchema.parse(trigger)), trigger.id);
    this.db
      .prepare(
        "DELETE FROM event_targets WHERE trigger_id=? AND event_id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?,'$.events'))",
      )
      .run(trigger.id, JSON.stringify(trigger));
  }
  hash(id: string): string | undefined {
    return this.db.prepare("SELECT hash FROM triggers WHERE id=?").get(id)?.hash as
      string | undefined;
  }
  remove(id: string) {
    this.db.prepare("DELETE FROM pending WHERE trigger_id=?").run(id);
    this.db.prepare("DELETE FROM event_targets WHERE trigger_id=?").run(id);
    this.db.prepare("DELETE FROM triggers WHERE id=?").run(id);
    this.db.prepare("DELETE FROM keys WHERE trigger_id=?").run(id);
  }
  receipt(request: TriggerRequest): TriggerResult | undefined {
    const row = this.db.prepare("SELECT request FROM receipts WHERE id=?").get(request.requestId);
    if (!row) return;
    if (row.request !== JSON.stringify(request))
      throw new Error("Request ID was used for a different trigger change");
    return {
      type: "trigger.result",
      requestId: request.requestId,
      outcome: { status: "ok", triggers: this.list() },
    };
  }
  remember(request: TriggerRequest) {
    this.db
      .prepare("INSERT INTO receipts(id,request) VALUES(?,?)")
      .run(request.requestId, JSON.stringify(request));
    this.db.exec(
      "DELETE FROM receipts WHERE rowid NOT IN (SELECT rowid FROM receipts ORDER BY rowid DESC LIMIT 2048)",
    );
  }
  duplicate(id: string, key: string, cutoff: string): string | undefined {
    return this.db
      .prepare("SELECT event_id FROM keys WHERE trigger_id=? AND key=? AND received_at>=?")
      .get(id, key, cutoff)?.event_id as string | undefined;
  }
  rememberKey(id: string, key: string, eventId: string, now: string, cutoff: string) {
    this.db.prepare("INSERT OR REPLACE INTO keys VALUES(?,?,?,?)").run(id, key, now, eventId);
    this.db
      .prepare(
        "DELETE FROM keys WHERE trigger_id=? AND (received_at<? OR rowid NOT IN (SELECT rowid FROM keys WHERE trigger_id=? ORDER BY rowid DESC LIMIT 200))",
      )
      .run(id, cutoff, id);
  }
  retainedEvents(id: string): Set<string> {
    return new Set(
      this.db
        .prepare("SELECT event_id FROM keys WHERE trigger_id=?")
        .all(id)
        .map((r) => String(r.event_id)),
    );
  }
  eventTargets(id: string): Map<string, string> {
    return new Map(
      this.db
        .prepare("SELECT event_id,target FROM event_targets WHERE trigger_id=?")
        .all(id)
        .map((row) => [String(row.event_id), String(row.target)]),
    );
  }
  rememberTarget(triggerId: string, eventId: string, target: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO event_targets VALUES(?,?,?)")
      .run(eventId, triggerId, target);
  }
  defer(triggerId: string, eventId: string, sessionId: string, text: string) {
    this.db.prepare("INSERT INTO pending VALUES(?,?,?,?)").run(eventId, triggerId, sessionId, text);
  }
  pending(sessionId?: string) {
    const rows = sessionId
      ? this.db.prepare("SELECT * FROM pending WHERE session_id=? ORDER BY rowid").all(sessionId)
      : this.db.prepare("SELECT * FROM pending ORDER BY rowid").all();
    return rows.map((row) => ({
      eventId: String(row.event_id),
      triggerId: String(row.trigger_id),
      sessionId: String(row.session_id),
      text: String(row.text),
    }));
  }
  removePending(eventId: string) {
    this.db.prepare("DELETE FROM pending WHERE event_id=?").run(eventId);
  }
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
  close() {
    this.db.close();
  }
}
