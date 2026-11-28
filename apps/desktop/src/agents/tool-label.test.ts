import { describe, expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import {
  argumentsSummary,
  commandSummary,
  controlStep,
  controlSummary,
  parseToolTitle,
  toolDisplayName,
  toolSummary,
  quietSubAgentStep,
} from "./tool-label";
import { timelineView } from "./thinking";

const item = (id: string, extra: Partial<AgentItem> = {}): AgentItem => ({
  id,
  sessionId: "session",
  turnId: "turn",
  position: 0,
  revision: 0,
  kind: "tool",
  title: " · mcp__concors-supervisor__concors_control",
  text: "mcp__concors-supervisor__concors_control",
  detail: "",
  status: "completed",
  createdAt: "2026-11-17T00:00:00.000Z",
  presentation: { type: "mcp", input: '{\n  "operation": {\n    "kind": "workspaces"\n  }\n}' },
  ...extra,
});

describe("tool labels", () => {
  it("names Claude's MCP and built-in tools for people", () => {
    expect(parseToolTitle(" · mcp__concors-supervisor__concors_control")).toEqual({
      tool: "concors_control",
      server: "concors-supervisor",
    });
    expect(toolDisplayName(" · mcp__concors-supervisor__concors_control")).toBe("Concors control");
    expect(toolDisplayName("· ToolSearch")).toBe("Tool search");
    expect(toolDisplayName("github · create_issue")).toBe("Create issue");
    expect(toolDisplayName("Search the web")).toBe("Search the web");
    expect(toolDisplayName("mcp.workspace.inspect")).toBe("mcp.workspace.inspect");
  });

  it("summarizes a call by its arguments, not its own name again", () => {
    expect(argumentsSummary('{"query":"select:Read","max_results":5}')).toBe("select:Read");
    expect(argumentsSummary('{"operation":{"kind":"read","sessionId":"s1"}}')).toBe("read, s1");
    expect(toolSummary(item("b", { presentation: { type: "mcp" } }))).toBe("Concors supervisor");
  });
});

describe("Concors control rows", () => {
  const WRITER = "5c176bb4-0529-4e6f-87cc-2a1f5ceaa2f7";
  const REVIEWER = "e96d894c-e881-438d-8042-00ea7244864f";
  const GONE = "66e1a4d2-764d-4ff2-be31-f4a3528c0385";
  const SANDBOX = "0b7f4c1e-8f53-4a43-9a8e-6d0c3a1b2c3d";
  const names = new Map([
    [WRITER, "Sandbox – writer"],
    [REVIEWER, "Sandbox – reviewer"],
    [SANDBOX, "Sandbox"],
  ]);
  const nameOf = (id: string) => names.get(id);
  const call = (operation: Record<string, unknown>, extra: Partial<AgentItem> = {}) =>
    item("call", { presentation: { type: "mcp", input: JSON.stringify({ operation }) }, ...extra });
  const say = (operation: Record<string, unknown>, live = false) =>
    controlSummary(call(operation), nameOf, live);

  it("say what each operation did, by chat name", () => {
    expect(say({ kind: "workspaces" })).toBe("Listed workspaces");
    expect(say({ kind: "layout", projectId: SANDBOX })).toBe("Read the layout of Sandbox");
    expect(say({ kind: "sessions" })).toBe("Listed chats");
    expect(say({ kind: "sessions", projectId: SANDBOX })).toBe("Listed chats in Sandbox");
    expect(say({ kind: "sessions", query: "haiku\nmore" })).toBe("Searched chats for haiku");
    expect(say({ kind: "read", sessionId: WRITER })).toBe("Read Sandbox – writer");
    expect(say({ kind: "send", sessionId: WRITER, text: "Write haiku.txt" })).toBe(
      "Sent instructions to Sandbox – writer",
    );
    expect(say({ kind: "send", sessionId: WRITER, text: "x", whenBusy: "queue" })).toBe(
      "Sent instructions to Sandbox – writer",
    );
    expect(say({ kind: "send", sessionId: WRITER, text: "x", whenBusy: "steer" })).toBe(
      "Steered Sandbox – writer",
    );
    expect(
      say({ kind: "start", projectId: SANDBOX, provider: "claude", name: "Sandbox – tester" }),
    ).toBe("Started Sandbox – tester");
    expect(say({ kind: "start", projectId: SANDBOX, provider: "claude" })).toBe(
      "Started a chat in Sandbox",
    );
    expect(say({ kind: "start", projectId: GONE, provider: "claude" })).toBe("Started a chat");
    expect(
      say({
        kind: "workspace",
        command: { type: "workspace.command", operation: { kind: "tab.move", projectId: SANDBOX } },
      }),
    ).toBe("Changed the tabs of Sandbox");
    expect(say({ kind: "open-session", sessionId: WRITER })).toBe("Opened Sandbox – writer");
    expect(say({ kind: "queue-remove", sessionId: WRITER, id: GONE })).toBe(
      "Removed a queued instruction from Sandbox – writer",
    );
    expect(say({ kind: "interrupt", sessionId: WRITER, turnId: "t", confirmed: true })).toBe(
      "Stopped Sandbox – writer",
    );
    expect(say({ kind: "status" })).toBe("Checked delivery status");
    expect(say({ kind: "capabilities" })).toBe("Checked agents and permissions");
    expect(say({ kind: "watch", sessionId: REVIEWER })).toBe("Watching Sandbox – reviewer");
    expect(say({ kind: "watch", sessionId: REVIEWER, enabled: false })).toBe(
      "Stopped watching Sandbox – reviewer",
    );
    expect(say({ kind: "wait", sessionIds: [REVIEWER] })).toBe("Waited on Sandbox – reviewer");
    expect(say({ kind: "wait", sessionIds: [REVIEWER, WRITER], on: "change" })).toBe(
      "Waited on Sandbox – reviewer and Sandbox – writer",
    );
  });

  it("name both chats of a wait on two known chats, and count three or more or any unknown", () => {
    expect(say({ kind: "wait", sessionIds: [WRITER, REVIEWER] }, true)).toBe(
      "Waiting on Sandbox – writer and Sandbox – reviewer",
    );
    expect(say({ kind: "wait", sessionIds: [WRITER, GONE] })).toBe("Waited on 2 chats");
    expect(say({ kind: "wait", sessionIds: [WRITER, REVIEWER, WRITER] })).toBe("Waited on 3 chats");
    expect(controlSummary(call({ kind: "wait", sessionIds: [WRITER, REVIEWER] }))).toBe(
      "Waited on 2 chats",
    );
  });

  it("say it in the present tense while the call runs", () => {
    expect(say({ kind: "send", sessionId: WRITER, text: "x" }, true)).toBe(
      "Sending instructions to Sandbox – writer",
    );
    expect(say({ kind: "wait", sessionIds: [REVIEWER] }, true)).toBe(
      "Waiting on Sandbox – reviewer",
    );
    expect(say({ kind: "start", projectId: SANDBOX, provider: "c", name: "T" }, true)).toBe(
      "Starting T",
    );
    expect(say({ kind: "sessions", query: "haiku" }, true)).toBe("Searching chats for haiku");
    expect(controlStep(call({ kind: "read", sessionId: WRITER }), nameOf, true)).toEqual({
      verb: "Reading",
      target: "Sandbox – writer",
    });
  });

  it('never show an ID: a chat the client cannot name is "a chat"', () => {
    expect(say({ kind: "send", sessionId: GONE, text: "x" })).toBe("Sent instructions to a chat");
    expect(say({ kind: "wait", sessionIds: [GONE] })).toBe("Waited on a chat");
    expect(say({ kind: "layout", projectId: GONE })).toBe("Read the layout of a workspace");
    expect(controlSummary(call({ kind: "read", sessionId: WRITER }))).toBe("Read a chat");
    for (const operation of [
      { kind: "send", sessionId: GONE, text: "x" },
      { kind: "wait", sessionIds: [GONE, WRITER] },
      { kind: "queue-remove", sessionId: GONE, id: GONE },
    ])
      expect(toolSummary(call(operation), nameOf)).not.toMatch(/[0-9a-f]{8}-/);
  });

  it("read an operation this client does not know as its own name, and nothing half-written", () => {
    expect(say({ kind: "new-thing", sessionId: GONE })).toBe("New thing");
    expect(toolSummary(item("a"))).toBe("Listed workspaces");
    expect(
      toolSummary(item("s", { presentation: { type: "mcp", input: '{"operation":{"ki' } })),
    ).toBe("");
    expect(controlStep(item("t", { title: " · ToolSearch", text: "ToolSearch" }))).toBeUndefined();
  });
});

describe("rows from Claude Code's own tools", () => {
  // As 0.18.2 showed them: "· listagents  ListAgents", "· sendmessage  SendMessage".
  it("say each name once", () => {
    const claude = (name: string, input?: string) =>
      item(name, {
        title: ` · ${name}`,
        text: name,
        presentation: { type: "mcp", ...(input ? { input } : {}) },
      });
    expect(toolDisplayName(" · ListAgents")).toBe("List agents");
    expect(toolSummary(claude("ListAgents", "{}"))).toBe("");
    expect(toolDisplayName(" · SendMessage")).toBe("Send message");
    expect(toolSummary(claude("SendMessage", '{"to":"reviewer","message":"Ship it"}'))).toBe(
      "reviewer, Ship it",
    );
  });

  it("show what a command ran, not the folder it changed into first", () => {
    expect(commandSummary("cd ~/work/router-superset-app && git log --oneline")).toBe(
      "git log --oneline",
    );
    expect(commandSummary("cd '/tmp/my app'; date -u +%T")).toBe("date -u +%T");
    expect(commandSummary("cd ~/work/router-superset-app")).toBe("cd ~/work/router-superset-app");
    expect(commandSummary("pnpm test && cd docs")).toBe("pnpm test && cd docs");
  });
});

describe("tool runs", () => {
  it("folds the same tool called back to back into one row under its first id", () => {
    const view = timelineView([
      item("search", { title: " · ToolSearch", text: "ToolSearch" }),
      item("c1"),
      item("c2", { status: "failed" }),
      item("c3"),
      item("shell", { title: "Run command", presentation: { type: "shell" } }),
      item("shell-2", { title: "Run command", presentation: { type: "shell" } }),
      item("c4"),
      item("c5", { turnId: "next" }),
    ]);
    expect(view.map((entry) => [entry.id, entry.group?.map((i) => i.id) ?? null])).toEqual([
      ["search", null],
      ["c1", ["c1", "c2", "c3"]],
      ["shell", null],
      ["shell-2", null],
      ["c4", null],
      ["c5", null],
    ]);
    expect(view[1]?.status).toBe("failed");
  });

  it("keeps a run live while any call in it is running", () => {
    const [run] = timelineView([item("c1"), item("c2", { status: "running" })]);
    expect(run?.status).toBe("running");
  });
});

describe("quietSubAgentStep", () => {
  it("names a Codex-style sub-agent's command as a command, running or done", () => {
    expect(quietSubAgentStep({ title: "Run command", status: "running" })).toBe(
      "Running a command",
    );
    expect(quietSubAgentStep({ title: "Run command", status: "completed" })).toBe("Ran a command");
    expect(quietSubAgentStep({ title: "Run command", status: "failed" })).toBe("Ran a command");
  });

  it("leaves other steps, and Claude Code's described Bash, to their own words", () => {
    expect(quietSubAgentStep({ title: "Bash", status: "running" })).toBeUndefined();
    expect(quietSubAgentStep({ title: "Read file", status: "running" })).toBeUndefined();
  });
});
