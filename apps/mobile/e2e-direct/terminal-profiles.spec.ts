import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";

test("mobile saves and launches machine terminal profiles", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-mobile-profiles-"));
  const desktop = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7440/ws"),
    client: { kind: "desktop", name: "profile-acceptance", version: "0.1.0" },
  });
  const unsubscribe = desktop.subscribeWorkspace(() => undefined);
  const projectId = crypto.randomUUID();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const execute = async (operation: WorkspaceOperation) => {
    const workspace = desktop.workspace;
    if (!workspace) throw new Error("Desktop control client has no workspace snapshot");
    const result = await desktop.executeWorkspace({
      type: "workspace.command",
      commandId: crypto.randomUUID(),
      epoch: workspace.epoch,
      operation,
    });
    expect(result.outcome.status).toBe("accepted");
  };
  try {
    await desktop.connect();
    await expect.poll(() => desktop.workspace).toBeTruthy();
    await execute({ kind: "project.add", projectId, name: "Mobile profiles", directory });
    await execute({ kind: "selection.set", projectId, tabId: null });
    await page.goto("/");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    await page.getByRole("button", { name: "Allow AI data sharing", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    await ui.getByRole("button", { name: "Create a tab", exact: true }).click();
    await ui.getByRole("button", { name: "Add terminal profile…", exact: true }).click();
    const editor = ui.getByRole("dialog", { name: "Add terminal profile", exact: true });
    await editor.getByLabel("Name", { exact: true }).fill("Mobile task");
    await editor.getByLabel("Command", { exact: true }).fill(process.execPath);
    await editor
      .getByLabel("Arguments", { exact: true })
      .fill(
        [
          "-e",
          'console.log("MOBILE_PROFILE:"+JSON.stringify(process.argv.slice(1))); process.stdin.resume()',
          "two words",
          "literal & $()",
        ].join("\n"),
      );
    await editor.getByRole("button", { name: "Save profile", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect
      .poll(() => desktop.workspace?.terminalProfiles?.some((item) => item.name === "Mobile task"))
      .toBe(true);
    await ui
      .getByRole("dialog", { name: "Settings", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await ui.getByRole("button", { name: "Create a tab", exact: true }).click();
    await ui.getByRole("button", { name: "Mobile task", exact: true }).click();
    await expect(ui.getByLabel("Terminal output", { exact: true })).toContainText(
      'MOBILE_PROFILE:["two words","literal & $()"]',
    );
    await expect(ui.getByRole("combobox", { name: "Tabs and panes" })).toContainText("Mobile task");
    expect(errors).toEqual([]);
  } finally {
    desktop.disconnect();
    unsubscribe();
    await rm(directory, { recursive: true, force: true });
  }
});
