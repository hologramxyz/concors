import { expect, it } from "vitest";
import type { AgentInfo, TerminalInfo, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import { tabAgentStatuses, workspaceAttention, workspaceAttentionLabel } from "./agent-status";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pane = (n: number, profile: "chat" | "shell" | "codex", sessionId: string | null) => ({
  id: id(n),
  kind: "pane" as const,
  profile,
  sessionId,
});
const chat = (n: number, status: AgentInfo["status"]) =>
  ({ id: id(n), provider: "claude", name: "Claude", status }) as AgentInfo;
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
  expect(unseen).toMatchObject({ status: "Done", color: "bg-primary", unread: true });
  const [seen] = tabAgentStatuses(tab, [finished(true)], []);
  expect(seen).toMatchObject({ status: "Ready", color: "", unread: false });
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
  expect(workspaceAttentionLabel(all)).toBe("2 needs input · 1 failed · 1 done · 1 working");
});
