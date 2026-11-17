import { expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { noticePlace } from "./place";

const workspace: Pick<WorkspaceSnapshot, "projects"> = {
  projects: [
    {
      id: "studio",
      name: "studio",
      directory: "/repos/studio",
      version: 1,
      tabs: [
        {
          id: "named",
          name: "Release",
          root: "pane",
          nodes: [{ kind: "pane", id: "pane", profile: "chat", sessionId: "chat" }],
        },
        {
          id: "unnamed",
          name: "Tab 2",
          root: "other-pane",
          nodes: [{ kind: "pane", id: "other-pane", profile: "chat", sessionId: "other" }],
        },
      ],
    },
  ],
};

it("places a chat in its workspace, and in its tab when someone named the tab", () => {
  expect(noticePlace(workspace, { id: "chat", projectId: "studio" })).toEqual({
    projectId: "studio",
    workspace: "studio",
    tab: "Release",
  });
  expect(noticePlace(workspace, { id: "other", projectId: "studio" })).toEqual({
    projectId: "studio",
    workspace: "studio",
    tab: "",
  });
  expect(noticePlace(workspace, { id: "gone", projectId: "removed" }).workspace).toBe("");
});

it("places the Supervisor's chat, which is in no workspace, by name", () => {
  expect(
    noticePlace(workspace, { id: "supervisor", projectId: "supervisor-project", supervisor: true }),
  ).toEqual({ projectId: "supervisor-project", workspace: "Supervisor", tab: "" });
});
