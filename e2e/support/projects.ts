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
    await expect
      .poll(
        () => connection.workspace?.projects.find((project) => project.id === projectId)?.tabs[0],
      )
      .toBeTruthy();
    if (initialPane === "terminal") {
      const project = connection.workspace?.projects.find((item) => item.id === projectId);
      const tab = project?.tabs[0];
      const pane = tab?.nodes.find((node) => node.id === tab.root);
      if (!project || !tab || !pane || pane.kind !== "pane")
        throw new Error("Seeded project did not create its initial pane");
      const currentWorkspace = connection.workspace;
      if (!currentWorkspace) throw new Error("Workspace disconnected while seeding project");
      const configured = await connection.executeWorkspace({
        type: "workspace.command",
        commandId: crypto.randomUUID(),
        epoch: currentWorkspace.epoch,
        operation: {
          kind: "pane.configure",
          projectId,
          expectedVersion: project.version,
          tabId: tab.id,
          paneId: pane.id,
          profile: "shell",
        },
      });
      expect(configured.outcome.status).toBe("accepted");
      await expect
        .poll(() => {
          const node = connection.workspace?.projects
            .find((item) => item.id === projectId)
            ?.tabs[0]?.nodes.find((item) => item.id === pane.id);
          return node?.kind === "pane" ? node.profile : undefined;
        })
        .toBe("shell");
    }
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
