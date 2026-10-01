import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { AgentInfoSchema, AgentMessageIndexSchema, type AgentItem } from "@concors/protocol";
import { WorkspaceStore } from "../workspace/store.ts";

it("indexes only sent messages across pages, isolates sessions, bounds previews and includes attachments", () => {
  const directory = mkdtempSync(join(tmpdir(), "concors-message-index-"));
  const path = join(directory, "state.db");
  const store = new WorkspaceStore(path);
  const db = new DatabaseSync(path);
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  try {
    const agent = AgentInfoSchema.parse({
      id: sessionId,
      projectId: randomUUID(),
      provider: "codex",
      name: "Index",
      directory: "/tmp",
      model: null,
      threadId: null,
      status: "idle",
      turnId: null,
      pending: [],
      error: null,
      startedAt: now,
      turnStartedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    });
    db.prepare("INSERT INTO agents (id, info) VALUES (?, ?)").run(sessionId, JSON.stringify(agent));
    const save = (id: string, kind: AgentItem["kind"], text: string, other = sessionId) =>
      store.saveAgentItem({
        id,
        sessionId: other,
        turnId: "turn",
        position: 0,
        revision: 0,
        kind,
        title: "",
        text,
        detail: "private tool details",
        status: "completed",
        createdAt: now,
      });
    save("tool-before", "tool", "not a message");
    // One commit for the 410 setup writes, as a replayed history is written: each on its own is a
    // synchronous disk flush, which took this test past its time limit on Windows runners.
    store.transaction(() => {
      for (let i = 0; i < 205; i++) {
        save(`prompt:${i}`, "user", `Message ${i}\n${"x".repeat(500)}`);
        save(`output:${i}`, "assistant", "output");
      }
    });
    save("foreign", "user", "Other session", randomUUID());
    const attachment = save("attachment", "user", "");
    store.saveAgentItem({
      ...attachment,
      attachments: [{ name: "notes.md", mime: "text/markdown" }],
    });
    const page = AgentMessageIndexSchema.parse(store.agentMessageIndex(sessionId));
    expect(page.messages).toHaveLength(200);
    expect(page.hasMore).toBe(true);
    expect(page.messages.at(-1)?.preview).toBe("notes.md");
    expect(page.messages[0]?.preview).toHaveLength(240);
    const older = store.agentMessageIndex(sessionId, page.messages[0]!.position);
    expect(older.messages).toHaveLength(6);
    expect(older.hasMore).toBe(false);
    const all = [...older.messages, ...page.messages];
    expect(new Set(all.map((m) => m.id)).size).toBe(206);
    expect(all[0]?.id).toBe("prompt:0");
    expect(JSON.stringify(all)).not.toContain("private tool details");
    expect(all.some((m) => m.id === "foreign")).toBe(false);
    expect(() => store.agentMessageIndex(randomUUID())).toThrow();
  } finally {
    db.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("finds a turn's prompt after a long turn has pushed it out of the latest page", () => {
  const directory = mkdtempSync(join(tmpdir(), "concors-turn-prompt-"));
  const store = new WorkspaceStore(join(directory, "state.db"));
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  try {
    const save = (id: string, kind: AgentItem["kind"], turnId: string) =>
      store.saveAgentItem({
        id,
        sessionId,
        turnId,
        position: 0,
        revision: 0,
        kind,
        title: "",
        text: "",
        detail: "",
        status: "completed",
        createdAt: now,
      });
    save("prompt:request", "user", "turn");
    // More than the 80-item page the replay dedupe used to consult.
    for (let i = 0; i < 100; i++) save(`tool:${i}`, "tool", "turn");
    save("tool:other", "tool", "other");
    expect(store.hasAgentTurnPrompt(sessionId, "turn")).toBe(true);
    expect(store.hasAgentTurnPrompt(sessionId, "other")).toBe(false);
    expect(store.hasAgentTurnPrompt(randomUUID(), "turn")).toBe(false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
