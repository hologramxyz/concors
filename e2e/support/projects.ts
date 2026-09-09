import { expect, type Page } from "@playwright/test";
import {
  DaemonConnection,
  describeDaemonEndpoint,
} from "../../packages/daemon-client/src/index.ts";

/** Seed named legacy projects for tests of unrelated features. Folder creation has dedicated UI coverage. */
export async function seedProject(
  page: Page,
  name: string,
  directory: string,
  url = "ws://127.0.0.1:7429/ws",
) {
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
    const result = await connection.requestProject(
      {
        kind: "start",
        epoch: workspace.epoch,
        id: crypto.randomUUID(),
        mode: "open",
        name,
        directory,
        repository: "",
      },
      crypto.randomUUID(),
    );
    expect(result.outcome.status).toBe("ok");
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
