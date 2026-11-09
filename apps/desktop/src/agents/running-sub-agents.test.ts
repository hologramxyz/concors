import { expect, it } from "vitest";
import { SUB_AGENT_STEPS, type AgentItem } from "@concors/protocol";
import {
  knownSubAgentRows,
  runningSubAgents,
  stepCount,
  subAgentLabel,
} from "./running-sub-agents";

function row(id: string, overrides: Partial<AgentItem> = {}): AgentItem {
  return {
    id,
    sessionId: "00000000-0000-4000-8000-000000000001",
    position: 1,
    revision: 0,
    turnId: "turn",
    kind: "tool",
    title: "Sub-agents",
    text: `Task ${id}`,
    detail: "",
    status: "running",
    createdAt: "2026-11-03T00:00:00.000Z",
    presentation: {
      type: "sub_agent",
      children: [{ id: `child-${id}`, status: "running", message: null }],
    },
    ...overrides,
  };
}
const working = { status: "working", turnId: "turn", backgroundAgents: 0 } as const;
const idle = { status: "done", turnId: null, backgroundAgents: 0 } as const;
const keys = (rows: AgentItem[], chat: Parameters<typeof runningSubAgents>[1]) =>
  runningSubAgents(rows, chat).map((agent) => agent.key);

it("pins a sub-agent while its turn runs, and not once that turn is over", () => {
  expect(keys([row("a")], working)).toEqual(["child-a"]);
  expect(keys([row("a")], idle)).toEqual([]);
  expect(keys([row("a", { turnId: "earlier" })], working)).toEqual([]);
});

it("pins one sent to the background until it finishes, whatever the turn does", () => {
  const background = (status: AgentItem["status"], turnId = "earlier") =>
    row("a", {
      status,
      turnId,
      presentation: {
        type: "sub_agent",
        background: true,
        children: [
          { id: "child-a", status: status === "running" ? "running" : status, message: null },
        ],
      },
    });
  expect(keys([background("running")], { ...idle, backgroundAgents: 1 })).toEqual(["child-a"]);
  expect(keys([background("running")], { ...working, backgroundAgents: 1 })).toEqual(["child-a"]);
  expect(keys([background("completed")], { ...idle, backgroundAgents: 1 })).toEqual([]);
  // A restart or failed CLI zeroes the count: a row left marked running must not stay pinned.
  expect(keys([background("running")], idle)).toEqual([]);
});

it("does not pin a failed or interrupted call whose child never reported an end", () => {
  expect(keys([row("a", { status: "failed" })], working)).toEqual([]);
  expect(keys([row("a", { status: "interrupted" })], working)).toEqual([]);
});

it("pins a call with no conversation yet by the call itself", () => {
  const [agent] = runningSubAgents(
    [row("a", { presentation: { type: "sub_agent", children: [] } })],
    working,
  );
  expect(agent).toMatchObject({ key: "a", task: "Task a" });
  expect(agent?.childId).toBeUndefined();
});

it("gives each of several children its own pin and steps", () => {
  const step = (childId: string) => ({
    id: childId,
    title: "Read",
    text: childId,
    status: "running" as const,
    childId,
  });
  const agents = runningSubAgents(
    [
      row("a", {
        presentation: {
          type: "sub_agent",
          children: [
            { id: "one", status: "running", message: null },
            { id: "two", status: "completed", message: "Done" },
            { id: "three", status: "pendingInit", message: null },
          ],
          activity: [step("one"), step("two"), step("three")],
        },
      }),
    ],
    working,
  );
  expect(agents.map((agent) => [agent.key, agent.index])).toEqual([
    ["one", 0],
    ["three", 2],
  ]);
  expect(agents[0]?.steps.map((entry) => entry.childId)).toEqual(["one"]);
});

it("lets Codex's later call speak for a child, keeping the task from the one that started it", () => {
  const spawn = row("spawn", {
    status: "completed",
    position: 1,
    text: "Check coverage",
    presentation: {
      type: "sub_agent",
      children: [{ id: "child", status: "pendingInit", message: null }],
    },
  });
  const wait = (status: string) =>
    row("wait", {
      position: 2,
      text: "wait",
      presentation: { type: "sub_agent", children: [{ id: "child", status, message: null }] },
    });
  expect(runningSubAgents([spawn], working)[0]?.task).toBe("Check coverage");
  const waiting = runningSubAgents([spawn, wait("running")], working);
  expect(waiting.map((agent) => [agent.key, agent.task])).toEqual([["child", "Check coverage"]]);
  expect(waiting[0]?.item.id).toBe("wait");
  expect(keys([spawn, wait("completed")], working)).toEqual([]);
});

it("ignores progress notes about a child, which carry an event name as their status", () => {
  const note = row("note", {
    title: "Sub-agent activity",
    position: 2,
    presentation: {
      type: "sub_agent",
      children: [{ id: "child-a", status: "message", message: "Reading" }],
    },
  });
  expect(keys([row("a"), note], working)).toEqual(["child-a"]);
});

it("merges tracked rows over the window's copies, in the order they started", () => {
  const window = [
    row("late", { position: 90, status: "completed" }),
    row("note", { position: 91, kind: "assistant", presentation: undefined }),
  ];
  const tracked = [row("early", { position: 2 }), row("late", { position: 90 })];
  const rows = knownSubAgentRows(window, tracked);
  expect(rows.map((entry) => [entry.id, entry.status])).toEqual([
    ["early", "running"],
    ["late", "running"],
  ]);
});

it("says when a row's steps have started dropping", () => {
  expect(stepCount([])).toBeNull();
  expect(stepCount([1])).toBe("1 step");
  expect(stepCount([1, 2])).toBe("2 steps");
  expect(stepCount(Array.from({ length: SUB_AGENT_STEPS }))).toBe(`${SUB_AGENT_STEPS}+ steps`);
});

it("names a sub-agent by its kind only when the kind says something", () => {
  // Each CLI's catch-all kind would head nearly every row alike.
  expect(subAgentLabel("general-purpose")).toBe("Sub-agent");
  expect(subAgentLabel("general")).toBe("Sub-agent");
  expect(subAgentLabel("default")).toBe("Sub-agent");
  expect(subAgentLabel(undefined)).toBe("Sub-agent");
  expect(subAgentLabel("  ")).toBe("Sub-agent");
  expect(subAgentLabel("Explore")).toBe("Explore");
  expect(subAgentLabel("code-reviewer")).toBe("code-reviewer");
  expect(subAgentLabel("general-purpose", 1)).toBe("Sub-agent 2");
  expect(subAgentLabel("explorer", 0)).toBe("explorer 1");
});
