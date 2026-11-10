import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { chooseProvider } from "../../../e2e/support/agents.ts";
import { expect, test } from "./fixtures";

test("browser workspaces send AI requests without the iOS consent prompt", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  const directory = await mkdtemp(join(tmpdir(), "concors-ai-permission-"));
  const desktop = new DaemonConnection({
    endpoint: describeDaemonEndpoint(mobileDesktopSocket),
    client: { kind: "test", name: "ai-permission", version: "0.1.0" },
  });
  const off = desktop.subscribeWorkspace(() => undefined);
  const projectId = crypto.randomUUID();
  const execute = async (operation: WorkspaceOperation) => {
    const workspace = desktop.workspace;
    if (!workspace) throw new Error("Missing fixture workspace");
    expect(
      (
        await desktop.executeWorkspace({
          type: "workspace.command",
          commandId: crypto.randomUUID(),
          epoch: workspace.epoch,
          operation,
        })
      ).outcome.status,
    ).toBe("accepted");
  };
  try {
    await desktop.connect();
    await expect.poll(() => desktop.workspace).toBeTruthy();
    await execute({ kind: "project.add", projectId, name: "AI permission", directory });
    await execute({
      kind: "tab.create",
      projectId,
      expectedVersion: 0,
      tabId: crypto.randomUUID(),
      paneId: crypto.randomUUID(),
      name: "Permission test",
      profile: "chat",
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    const composer = ui.getByRole("textbox", { name: "Message Codex", exact: true });
    const send = ui.getByRole("button", { name: "Send message", exact: true });
    await chooseProvider(ui);
    await composer.fill("Browser requests do not require iOS consent");
    await send.click();
    await expect(ui.getByRole("log")).toContainText("Browser requests do not require iOS consent");
    await expect
      .poll(() => desktop.agents.filter((agent) => agent.projectId === projectId).length)
      .toBe(1);
    expect(dialogs).toEqual([]);

    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Account: Your profile", exact: true }).click();
    await ui.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("combobox", { name: "Settings section" }).click();
    await ui.getByRole("option", { name: "Account", exact: true }).click();
    await expect(settings.getByText("AI data sharing", { exact: true })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Withdraw permission" })).toHaveCount(0);
  } finally {
    off();
    desktop.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
