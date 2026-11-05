import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { chooseProvider } from "../../../e2e/support/agents.ts";
import { expect, test } from "./fixtures";

test("AI sharing refusal, review and withdrawal control requests to the real machine", async ({
  page,
  aiSharing,
}) => {
  aiSharing.allow = false;
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
    // Opening a new chat starts its agent, so the first prompt precedes an editable composer.
    await expect.poll(() => aiSharing.disclosures.length).toBeGreaterThan(0);
    await expect(ui.getByText(/AI sharing (was not allowed|is off)/).first()).toBeVisible();
    expect(desktop.agents.filter((agent) => agent.projectId === projectId)).toHaveLength(0);

    const accountSettings = async () => {
      await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
      await ui.getByRole("button", { name: "Account: Your profile", exact: true }).click();
      await ui.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
      await settings.getByRole("combobox", { name: "Settings section" }).click();
      await ui.getByRole("option", { name: "Account", exact: true }).click();
      return settings;
    };
    let settings = await accountSettings();
    await expect(settings).toContainText("New agent requests from this iPhone are blocked.");
    aiSharing.allow = true;
    await settings.getByRole("button", { name: "Ask on the next request", exact: true }).click();
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await ui.getByRole("button", { name: "Retry", exact: true }).click();
    await chooseProvider(ui);
    await composer.fill("Allowed after review");
    await send.click();
    await expect(ui.getByRole("log")).toContainText("Allowed after review");
    await expect
      .poll(() => desktop.agents.filter((agent) => agent.projectId === projectId).length)
      .toBe(1);

    settings = await accountSettings();
    await settings.getByRole("button", { name: "Withdraw permission", exact: true }).click();
    await expect(settings).toContainText("New agent requests from this iPhone are blocked.");
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    const prompts = aiSharing.disclosures.length;
    await composer.fill("Blocked after withdrawal");
    await send.click();
    await expect(ui.getByText(/AI sharing is off/).first()).toBeVisible();
    await expect(ui.getByRole("log")).not.toContainText("Blocked after withdrawal");
    expect(aiSharing.disclosures).toHaveLength(prompts);
  } finally {
    off();
    desktop.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
