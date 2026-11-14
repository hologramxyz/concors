import { expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { agentReadiness, firstChatTarget, isUntouchedChat } from "./model";

it("calls an agent ready once it is installed and signed in, and never blocks on what it cannot tell", () => {
  const installed = { installed: true, installStatus: "installed" as const };
  expect(agentReadiness({ installed: false, installStatus: "idle" }, undefined, true)).toBe(
    "missing",
  );
  expect(agentReadiness({ installed: false, installStatus: "installing" }, undefined, true)).toBe(
    "installing",
  );
  expect(agentReadiness(installed, undefined, true)).toBe("checking");
  expect(agentReadiness(installed, { status: "disconnected" }, true)).toBe("sign-in");
  expect(agentReadiness(installed, { status: "pending" }, true)).toBe("sign-in");
  expect(agentReadiness(installed, { status: "connected" }, true)).toBe("ready");
  // An account the machine cannot read, or a daemon without accounts, leaves sign-in to the agent.
  expect(agentReadiness(installed, { status: "unknown" }, true)).toBe("ready");
  expect(agentReadiness(installed, null, true)).toBe("ready");
  expect(agentReadiness(installed, undefined, false)).toBe("ready");
});

it("hands the first task to a chat nobody wrote in yet", () => {
  expect(isUntouchedChat({ status: "idle", turnId: null })).toBe(true);
  expect(isUntouchedChat({ status: "starting", turnId: null })).toBe(false);
  expect(isUntouchedChat({ status: "done", turnId: "t1" })).toBe(false);
  expect(isUntouchedChat(undefined)).toBe(false);
});

it("finds the selected workspace's open chat, or the first workspace's first tab", () => {
  const pane = (id: string, profile: "chat" | "shell", sessionId: string | null) => ({
    kind: "pane" as const,
    id,
    profile,
    sessionId,
  });
  const workspace = {
    epoch: "e",
    projects: [
      {
        id: "a",
        name: "alpha",
        directory: "/a",
        version: 1,
        tabs: [{ id: "a1", name: "Tab 1", root: "p1", nodes: [pane("p1", "shell", "s0")] }],
      },
      {
        id: "b",
        name: "beta",
        directory: "/b",
        version: 1,
        tabs: [
          { id: "b1", name: "Tab 1", root: "p2", nodes: [pane("p2", "chat", "s1")] },
          { id: "b2", name: "Tab 2", root: "p3", nodes: [pane("p3", "chat", "s2")] },
        ],
      },
    ],
    selection: { projectId: "b", tabId: "b2" },
  } as unknown as WorkspaceSnapshot;
  expect(firstChatTarget(workspace)).toMatchObject({
    project: { id: "b" },
    tab: { id: "b2" },
    sessionId: "s2",
  });
  // Nothing selected: the first workspace's first tab, which is a terminal, so no chat to reuse.
  expect(firstChatTarget({ ...workspace, selection: null })).toMatchObject({
    project: { id: "a" },
    sessionId: null,
  });
  expect(firstChatTarget({ ...workspace, projects: [] })).toBeNull();
  expect(firstChatTarget(null)).toBeNull();
});
