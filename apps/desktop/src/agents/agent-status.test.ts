import { expect, it } from "vitest";
import type { AgentInfo, TerminalInfo, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import {
  chatDot,
  isActiveStatus,
  mostUrgentPane,
  tabAgentStatuses,
  workspaceAttention,
  workspaceAttentionLabel,
} from "./agent-status";
import { forgetTerminalTurn, markFailureSeen, markTerminalTurnSeen } from "./seen-updates";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pane = (n: number, profile: "chat" | "shell" | "codex", sessionId: string | null) => ({
  id: id(n),
  kind: "pane" as const,
  profile,
  sessionId,
});
const chat = (n: number, status: AgentInfo["status"]) =>
  ({
    id: id(n),
    provider: "claude",
    name: "Claude",
    status,
    updatedAt: new Date(0).toISOString(),
  }) as AgentInfo;
const terminal = (n: number, fields: Partial<TerminalInfo>) =>
  ({ id: id(n), profile: "codex", status: "running", ...fields }) as TerminalInfo;

it("lists every agent in a tab in reading order, skipping plain terminals", () => {
  // Split the second child first so layout order differs from the node array order.
  const tab: WorkspaceTab = {
    id: id(1),
    name: "Build",
    root: id(2),
    nodes: [
      { id: id(3), kind: "split", axis: "vertical", ratio: 0.5, first: id(12), second: id(13) },
      pane(13, "codex", id(23)),
      pane(12, "shell", id(22)),
      { id: id(2), kind: "split", axis: "horizontal", ratio: 0.5, first: id(11), second: id(3) },
      pane(11, "chat", id(21)),
    ],
  };
  const statuses = tabAgentStatuses(
    tab,
    [chat(21, "done")],
    [
      terminal(22, { profile: "shell", detectedAgent: null }),
      terminal(23, { agentActivity: "working" }),
    ],
  );
  expect(statuses.map(({ provider, status, running }) => ({ provider, status, running }))).toEqual([
    { provider: "claude", status: "Done", running: false },
    { provider: "codex", status: "Working", running: true },
  ]);
});

it("drops panes whose agent has not started or whose CLI has exited", () => {
  const tab: WorkspaceTab = {
    id: id(1),
    name: "Build",
    root: id(2),
    nodes: [
      { id: id(2), kind: "split", axis: "horizontal", ratio: 0.5, first: id(11), second: id(12) },
      pane(11, "chat", null),
      pane(12, "codex", id(22)),
    ],
  };
  expect(tabAgentStatuses(tab, [], [terminal(22, { status: "exited" })])).toEqual([]);
});

it("shows a finished chat agent as Ready once its completion has been seen", () => {
  const tab: WorkspaceTab = {
    id: id(1),
    name: "Build",
    root: id(11),
    nodes: [pane(11, "chat", id(21))],
  };
  const finished = (seen: boolean) =>
    ({
      ...chat(21, "done"),
      attention: { id: id(31), kind: "done", createdAt: new Date(0).toISOString(), seen },
    }) as AgentInfo;
  const [unseen] = tabAgentStatuses(tab, [finished(false)], []);
  expect(unseen).toMatchObject({ status: "Done", dot: "done" });
  const [seen] = tabAgentStatuses(tab, [finished(true)], []);
  expect(seen).toMatchObject({ status: "Ready", dot: undefined });
});

it("clears a finish or failure once opened, and a question only once answered", () => {
  const attention = (kind: "done" | "needs_input", seen: boolean) => ({
    id: id(31),
    kind,
    createdAt: new Date(0).toISOString(),
    seen,
  });
  const dot = (status: AgentInfo["status"], fields: Partial<AgentInfo> = {}) =>
    chatDot({ ...chat(21, status), ...fields });
  expect(dot("done", { attention: attention("done", false) })).toBe("done");
  expect(dot("done", { attention: attention("done", true) })).toBeUndefined();
  expect(dot("needs_input", { attention: attention("needs_input", false) })).toBe("attention");
  expect(dot("needs_input", { attention: attention("needs_input", true) })).toBe("attention");
  expect(dot("working")).toBeUndefined();
  expect(dot("interrupted")).toBeUndefined();

  // A failure has no attention record, so this client remembers it, per failure.
  const failed = { ...chat(21, "failed"), updatedAt: new Date(5).toISOString() };
  expect(chatDot(failed)).toBe("attention");
  markFailureSeen(failed);
  expect(chatDot(failed)).toBeUndefined();
  expect(chatDot({ ...failed, updatedAt: new Date(6).toISOString() })).toBe("attention");
});

it("clears a CLI's finished turn once viewed until its next turn, and keeps its questions", () => {
  const tab = (activity: TerminalInfo["agentActivity"]) =>
    tabAgentStatuses(
      { id: id(1), name: "Build", root: id(11), nodes: [pane(11, "codex", id(22))] },
      [],
      [terminal(22, { agentActivity: activity, agentTurnCompleted: activity !== "working" })],
    )[0];
  expect(tab("idle")).toMatchObject({ status: "Done", dot: "done" });
  markTerminalTurnSeen(id(22));
  expect(tab("idle")).toMatchObject({ status: "Done", dot: undefined });
  // Having viewed the terminal does not clear a question.
  expect(tab("needs_input")).toMatchObject({ status: "Needs input", dot: "attention" });
  forgetTerminalTurn(id(22));
  expect(tab("idle")).toMatchObject({ status: "Done", dot: "done" });
});

it("counts closed chats in their workspace's sum, as their rows show dots", () => {
  const project = { id: id(1), tabs: [] } as unknown as WorkspaceProject;
  const closed = {
    ...chat(21, "done"),
    projectId: id(1),
    turnId: id(40),
    updatedAt: new Date(0).toISOString(),
    attention: { id: id(31), kind: "done", createdAt: new Date(0).toISOString(), seen: false },
  } as AgentInfo;
  expect(workspaceAttention(project, [closed], [])).toMatchObject({ kind: "done", done: 1 });
});

it("sums a workspace's agents across its tabs, most urgent first, counting updates until seen", () => {
  // One tab per agent, each holding a single pane.
  const project = (sessions: [number, "chat" | "codex"][]) =>
    ({
      id: id(1),
      tabs: sessions.map(([session, profile], i) => ({
        id: id(100 + i),
        name: `Tab ${i}`,
        root: id(200 + i),
        nodes: [pane(200 + i, profile, id(session))],
      })),
    }) as WorkspaceProject;
  const unseen = { kind: "done", seen: false } as AgentInfo["attention"];
  const seen = { kind: "done", seen: true } as AgentInfo["attention"];
  const chats = [
    { ...chat(21, "done"), attention: unseen },
    { ...chat(22, "done"), attention: seen },
    { ...chat(23, "failed"), attention: { kind: "failed", seen: false } },
    chat(24, "working"),
    chat(25, "needs_input"),
  ] as AgentInfo[];
  const terminals = [terminal(26, { agentActivity: "needs_input" })];

  expect(workspaceAttention(project([]), chats, terminals).kind).toBeNull();
  // A finished agent someone has already looked at is not news.
  expect(workspaceAttention(project([[22, "chat"]]), chats, terminals).kind).toBeNull();
  expect(workspaceAttention(project([[24, "chat"]]), chats, terminals).kind).toBe("working");
  expect(
    workspaceAttention(
      project([
        [24, "chat"],
        [21, "chat"],
      ]),
      chats,
      terminals,
    ).kind,
  ).toBe("done");
  const all = workspaceAttention(
    project([
      [21, "chat"],
      [22, "chat"],
      [23, "chat"],
      [24, "chat"],
      [25, "chat"],
      [26, "codex"],
    ]),
    chats,
    terminals,
  );
  expect(all.kind).toBe("needs_input");
  expect(workspaceAttentionLabel(all)).toBe("2 chats need input, 1 failed, 1 finished");
  const none = { kind: null, needsInput: 0, failed: 0, done: 0, working: 0 };
  expect(workspaceAttentionLabel({ ...none, kind: "done", done: 1 })).toBe("1 chat finished");
  expect(workspaceAttentionLabel({ ...none, kind: "needs_input", needsInput: 1 })).toBe(
    "1 chat needs input",
  );
  // Working alone shows a spinner on a folded workspace, which says how many.
  expect(workspaceAttentionLabel({ ...none, kind: "working", working: 2 })).toBe("2 chats working");
  expect(workspaceAttentionLabel({ ...none, kind: "working", working: 1 })).toBe("1 chat working");
});

it("a tab's icon follows the most urgent pane, and the focused pane only breaks ties", () => {
  const panes = [pane(11, "chat", id(21)), pane(12, "chat", id(22)), pane(13, "chat", id(23))];
  const tab: WorkspaceTab = {
    id: id(1),
    name: "Build",
    root: id(2),
    nodes: [
      { id: id(2), kind: "split", axis: "horizontal", ratio: 0.5, first: id(11), second: id(3) },
      { id: id(3), kind: "split", axis: "vertical", ratio: 0.5, first: id(12), second: id(13) },
      ...panes,
    ],
  };
  const urgent = (
    first: AgentInfo["status"],
    second: AgentInfo["status"],
    third: AgentInfo["status"],
    focused: string | null = id(11),
  ) =>
    mostUrgentPane(tab, [chat(21, first), chat(22, second), chat(23, third)], [], focused)?.id ??
    null;
  expect(urgent("working", "needs_input", "failed")).toBe(id(12));
  expect(urgent("working", "idle", "failed")).toBe(id(13));
  expect(urgent("idle", "working", "idle")).toBe(id(12));
  expect(urgent("idle", "idle", "idle")).toBeNull();
  expect(urgent("working", "working", "working", id(13))).toBe(id(13));
  expect(urgent("working", "working", "working", null)).toBe(id(11));
});

it("a tab's tooltip lists agents that are busy, waiting or failed, and no others", () => {
  const tab: WorkspaceTab = {
    id: id(1),
    name: "Build",
    root: id(11),
    nodes: [pane(11, "chat", id(21))],
  };
  const lines = (status: AgentInfo["status"]) =>
    tabAgentStatuses(tab, [chat(21, status)], []).filter(isActiveStatus).length;
  expect(lines("working")).toBe(1);
  expect(lines("needs_input")).toBe(1);
  expect(lines("failed")).toBe(1);
  expect(lines("idle")).toBe(0);
  expect(lines("done")).toBe(0);
});
