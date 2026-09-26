import { expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { paneNames } from "./visible-sessions";

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
