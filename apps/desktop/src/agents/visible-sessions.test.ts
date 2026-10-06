import { expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { agentPane, paneNames } from "./visible-sessions";

it("maps each session to the name the user gave its pane, and nothing else", () => {
  const workspace: WorkspaceSnapshot = {
    schemaVersion: 1,
    machineId: "m",
    epoch: "e",
    revision: 1,
    selection: null,
    projects: [
      {
        id: "p",
        name: "Opser",
        directory: "/repos/opser",
        version: 1,
        tabs: [
          {
            id: "t",
            name: "Tab 1",
            root: "split",
            nodes: [
              {
                kind: "split",
                id: "split",
                axis: "horizontal",
                ratio: 0.5,
                first: "chat",
                second: "terminal",
              },
              { kind: "pane", id: "chat", profile: "chat", sessionId: "agent", name: "FTUE" },
              { kind: "pane", id: "terminal", profile: "shell", sessionId: "pty", name: "Claude" },
              { kind: "pane", id: "unnamed", profile: "chat", sessionId: "other" },
              { kind: "pane", id: "empty", profile: "chat", sessionId: null, name: "Draft" },
            ],
          },
        ],
      },
    ],
  };
  expect(paneNames(workspace)).toEqual(
    new Map([
      ["agent", "FTUE"],
      ["pty", "Claude"],
    ]),
  );
  expect(paneNames(null).size).toBe(0);
});

it("renames the pane whose name the sidebar shows, else the first pane holding the session", () => {
  const pane = (id: string, sessionId: string, name?: string) => ({
    kind: "pane" as const,
    id,
    profile: "chat" as const,
    sessionId,
    ...(name ? { name } : {}),
  });
  const workspace: WorkspaceSnapshot = {
    schemaVersion: 1,
    machineId: "m",
    epoch: "e",
    revision: 1,
    selection: null,
    projects: [
      {
        id: "p",
        name: "Opser",
        directory: "/repos/opser",
        version: 3,
        tabs: [
          { id: "t1", name: "Tab 1", root: "a", nodes: [pane("a", "agent"), pane("b", "other")] },
          { id: "t2", name: "Tab 2", root: "c", nodes: [pane("c", "agent", "FTUE")] },
          { id: "t3", name: "Tab 3", root: "d", nodes: [pane("d", "agent")] },
        ],
      },
    ],
  };
  expect(agentPane(workspace, "agent")).toMatchObject({
    project: { id: "p", version: 3 },
    tab: { id: "t2" },
    pane: { id: "c" },
  });
  expect(agentPane(workspace, "other")?.pane.id).toBe("b");
  expect(agentPane(workspace, "missing")).toBeNull();
  expect(agentPane(null, "agent")).toBeNull();
});
