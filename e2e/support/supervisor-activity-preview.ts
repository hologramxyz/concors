import { expect } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DaemonConnection,
  describeDaemonEndpoint,
} from "../../packages/daemon-client/src/index.ts";
import type { LayoutNode } from "../../packages/protocol/src/index.ts";

export const activityPrompt =
  "Check the game and the release notes. Tell me when anything needs my approval.";

export async function seedSupervisorActivity(url: string) {
  const directory = await mkdtemp(join(tmpdir(), "concors-activity-preview-"));
  const transport = new DaemonConnection({
    endpoint: describeDaemonEndpoint(url),
    client: { kind: "test", name: "activity preview", version: "0.0.0" },
  });
  const off = transport.subscribeWorkspace(() => undefined);
  let ids: { supervisor: string; tests: string; ui: string; notes: string };
  try {
    await transport.connect();
    await expect.poll(() => transport.workspace).not.toBeNull();
    const workspace = () => {
      if (!transport.workspace) throw new Error("Fixture workspace disconnected");
      return transport.workspace;
    };
    const command = async (
      operation: Parameters<typeof transport.executeWorkspace>[0]["operation"],
    ) => {
      const result = await transport.executeWorkspace({
        type: "workspace.command",
        commandId: crypto.randomUUID(),
        epoch: workspace().epoch,
        operation,
      });
      expect(result.outcome.status).toBe("accepted");
      if (result.outcome.status !== "accepted") throw new Error(result.outcome.message);
      const revision = result.outcome.revision;
      await expect.poll(() => workspace().revision).toBeGreaterThanOrEqual(revision);
    };
    const addProject = async (name: string, slug: string) => {
      const projectId = crypto.randomUUID();
      const path = join(directory, slug);
      await mkdir(path);
      await command({ kind: "project.add", projectId, name, directory: path });
      return projectId;
    };
    const start = async (projectId: string, tabId: string, paneId: string) => {
      const project =
        workspace().supervisor?.id === projectId
          ? workspace().supervisor
          : workspace().projects.find((p) => p.id === projectId);
      if (!project) throw new Error("No project for preview chat");
      const result = await transport.requestAgent(
        {
          kind: "start",
          provider: "codex",
          epoch: workspace().epoch,
          projectId,
          tabId,
          paneId,
          expectedVersion: project.version,
        },
        crypto.randomUUID(),
      );
      if (result.outcome.status !== "ok") throw new Error(result.outcome.message);
      const agent = result.outcome.conversation.agent;
      if (!agent) throw new Error("Preview agent not started");
      await expect
        .poll(() => transport.agents.find((a) => a.id === agent.id)?.threadId)
        .toBeTruthy();
      return agent.id;
    };
    const send = async (
      sessionId: string,
      text: string,
      status: "working" | "needs_input" | "done",
    ) => {
      const result = await transport.requestAgent(
        { kind: "send", sessionId, text },
        crypto.randomUUID(),
      );
      expect(result.outcome.status).toBe("ok");
      await expect
        .poll(() => transport.agents.find((a) => a.id === sessionId)?.status)
        .toBe(status);
    };
    const startWorker = async (projectId: string, name: string) => {
      const tabId = crypto.randomUUID(),
        paneId = crypto.randomUUID();
      const project = workspace().projects.find((project) => project.id === projectId);
      if (!project) throw new Error("Fixture project missing");
      await command({
        kind: "tab.create",
        projectId,
        expectedVersion: project.version,
        tabId,
        paneId,
        name,
        profile: "chat",
      });
      return start(projectId, tabId, paneId);
    };
    const game = await addProject("Star Catcher", "star-catcher");
    const docs = await addProject("Release Notes", "release-notes");
    const tests = await startWorker(game, "Game QA");
    const ui = await startWorker(game, "HUD polish");
    const notes = await startWorker(docs, "Release editor");
    const opened = await transport.requestSupervisor({ kind: "open" }, crypto.randomUUID());
    if (opened.outcome.status !== "ok" || !opened.outcome.project)
      throw new Error("Supervisor fixture did not open");
    const project = opened.outcome.project;
    const [tab] = project.tabs;
    const pane = tab?.nodes.find(
      (node): node is Extract<LayoutNode, { kind: "pane" }> => node.kind === "pane",
    );
    if (!tab || !pane) throw new Error("Supervisor fixture has no pane");
    const supervisor = await start(project.id, tab.id, pane.id);
    await send(supervisor, activityPrompt, "done");
    await expect
      .poll(() => transport.agents.find((agent) => agent.id === tests)?.status)
      .toBe("needs_input");
    await expect
      .poll(() => transport.agents.find((agent) => agent.id === ui)?.status)
      .toBe("working");
    await expect
      .poll(() => transport.agents.find((agent) => agent.id === notes)?.status)
      .toBe("done");
    const activity = await transport.requestSupervisor({ kind: "status" }, crypto.randomUUID());
    if (activity.outcome.status !== "ok") throw new Error(activity.outcome.message);
    expect(activity.outcome.deliveries.map((item) => item.status)).toEqual(
      expect.arrayContaining(["queued", "needs_input", "working", "done"]),
    );
    expect(activity.outcome.watching).toEqual(expect.arrayContaining([tests, ui, notes]));
    ids = { supervisor, tests, ui, notes };
  } finally {
    off();
    transport.disconnect();
  }
  return Object.assign(() => rm(directory, { recursive: true, force: true }), ids);
}
