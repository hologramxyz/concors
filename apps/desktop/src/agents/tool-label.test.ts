import { describe, expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import {
  argumentsSummary,
  commandSummary,
  parseToolTitle,
  toolDisplayName,
  toolSummary,
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
    expect(toolSummary(item("a"))).toBe("workspaces");
    expect(argumentsSummary('{"query":"select:Read","max_results":5}')).toBe("select:Read");
    expect(argumentsSummary('{"operation":{"kind":"read","sessionId":"s1"}}')).toBe("read, s1");
    expect(toolSummary(item("b", { presentation: { type: "mcp" } }))).toBe("Concors supervisor");
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
