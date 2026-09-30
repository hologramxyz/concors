import { expect, type Page } from "@playwright/test";
import {
  DaemonConnection,
  describeDaemonEndpoint,
} from "../../packages/daemon-client/src/index.ts";

interface SeedProjectOptions {
  url?: string;
  /** Preserve the product default when the test specifically covers initial-pane behavior. */
  initialPane?: "default" | "terminal";
}

/** Seed named legacy projects for tests of unrelated features. Folder creation has dedicated UI coverage. */
export async function seedProject(
  page: Page,
  name: string,
  directory: string,
  options: SeedProjectOptions = {},
) {
  const { initialPane = "terminal", url = "ws://127.0.0.1:7429/ws" } = options;
  const connection = new DaemonConnection({
    endpoint: describeDaemonEndpoint(url),
    client: { kind: "test", name: "workspace fixture", version: "0.0.0" },
  });
  const unsubscribe = connection.subscribeWorkspace(() => undefined);
  try {
    await connection.connect();
    await expect.poll(() => connection.workspace).not.toBeNull();
    const workspace = connection.workspace;
    if (!workspace) throw new Error("Workspace did not connect");
    const projectId = crypto.randomUUID();
    if (initialPane === "default") {
      const result = await connection.requestProject(
        {
          kind: "start",
          epoch: workspace.epoch,
          id: projectId,
          mode: "open",
          name,
          directory,
          repository: "",
        },
        crypto.randomUUID(),
      );
      expect(result.outcome.status).toBe("ok");
    } else {
      // Opening a folder starts it with an Agent pane, and the open app starts an agent there at
      // once. Build the project from workspace commands instead, so its first tab is a terminal
      // from the start and no agent is left behind in the folder (a machine keeps at most 128
      // saved sessions, and every spec shares these daemons).
      const execute = async (
        operation: Parameters<typeof connection.executeWorkspace>[0]["operation"],
      ) => {
        const current = connection.workspace;
        if (!current) throw new Error("Workspace disconnected while seeding project");
        const result = await connection.executeWorkspace({
          type: "workspace.command",
          commandId: crypto.randomUUID(),
          epoch: current.epoch,
          operation,
        });
        expect(result.outcome.status).toBe("accepted");
      };
      await execute({ kind: "project.add", projectId, name, directory });
      await expect
        .poll(() => connection.workspace?.projects.some((project) => project.id === projectId))
        .toBe(true);
      const paneId = crypto.randomUUID();
      await execute({
        kind: "tab.create",
        projectId,
        expectedVersion: 0,
        tabId: crypto.randomUUID(),
        paneId,
        name: "Tab 1",
        profile: "shell",
      });
      // The heading appears with the empty project; the spec's own edits need the page to have
      // the tab as well, or they are rejected as based on an outdated project.
      await expect(page.locator(`[data-pane-id="${paneId}"]`)).toBeVisible();
    }
    await expect
      .poll(
        () => connection.workspace?.projects.find((project) => project.id === projectId)?.tabs[0],
      )
      .toBeTruthy();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  } finally {
    unsubscribe();
    connection.disconnect();
  }
}
export async function openFolder(page: Page, directory: string) {
  await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open folder…", exact: true }).click();
  await expect(page.getByRole("button", { name: "Go", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "Folder path", exact: true }).fill(directory);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open folder", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
