import { expect } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DaemonConnection,
  describeDaemonEndpoint,
} from "../../packages/daemon-client/src/index.ts";
import type { WorkspaceOperation } from "../../packages/protocol/src/index.ts";

/** The same real-daemon fixture exercises desktop and mobile search navigation. */
export async function searchWorkspace(socket: string) {
  const root = await mkdtemp(join(tmpdir(), "concors-search-"));
  const firstDirectory = join(root, "frontend"),
    secondDirectory = join(root, "backend");
  await mkdir(firstDirectory);
  await mkdir(secondDirectory);
  const connection = new DaemonConnection({
    endpoint: describeDaemonEndpoint(socket),
    client: { kind: "desktop", name: "search-test", version: "0.1.0" },
  });
  const off = connection.subscribeWorkspace(() => undefined);
  const projectId = crypto.randomUUID(),
    otherProjectId = crypto.randomUUID(),
    tabId = crypto.randomUUID(),
    chatId = crypto.randomUUID(),
    terminalId = crypto.randomUUID(),
    otherTabId = crypto.randomUUID(),
    otherPaneId = crypto.randomUUID();
  const snapshot = () => {
    if (!connection.workspace) throw new Error("Missing search fixture workspace");
    return connection.workspace;
  };
  const project = () => {
    const item = snapshot().projects.find((p) => p.id === projectId);
    if (!item) throw new Error("Missing search fixture project");
    return item;
  };
  const execute = async (operation: WorkspaceOperation) => {
    const result = await connection.executeWorkspace({
      type: "workspace.command",
      commandId: crypto.randomUUID(),
      epoch: snapshot().epoch,
      operation,
    });
    expect(result.outcome.status).toBe("accepted");
  };
  const cleanup = async () => {
    off();
    connection.disconnect();
    await rm(root, { recursive: true, force: true });
  };
  try {
    await connection.connect();
    await expect.poll(() => connection.workspace).toBeTruthy();
    await execute({
      kind: "project.add",
      projectId,
      name: "Search Hologram",
      directory: firstDirectory,
      directoryMode: "pinned",
    });
    await execute({
      kind: "project.add",
      projectId: otherProjectId,
      name: "Search Hologram",
      directory: secondDirectory,
      directoryMode: "pinned",
    });
    await execute({
      kind: "tab.create",
      projectId,
      expectedVersion: project().version,
      tabId,
      paneId: chatId,
      name: "Build review",
      profile: "chat",
    });
    await execute({
      kind: "pane.split",
      projectId,
      expectedVersion: project().version,
      tabId,
      paneId: chatId,
      newPaneId: terminalId,
      splitId: crypto.randomUUID(),
      axis: "horizontal",
      profile: "shell",
    });
    const started = await connection.requestAgent(
      {
        kind: "start",
        epoch: snapshot().epoch,
        projectId,
        tabId,
        paneId: chatId,
        expectedVersion: project().version,
        provider: "codex",
      },
      crypto.randomUUID(),
    );
    expect(started.outcome.status).toBe("ok");
    await execute({
      kind: "tab.create",
      projectId,
      expectedVersion: project().version,
      tabId: otherTabId,
      paneId: otherPaneId,
      name: "Release notes",
      profile: "shell",
    });
    await execute({ kind: "selection.set", projectId, tabId: otherTabId });
    return {
      connection,
      snapshot,
      project,
      projectId,
      otherProjectId,
      tabId,
      chatId,
      terminalId,
      otherTabId,
      otherPaneId,
      firstDirectory,
      secondDirectory,
      execute,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
