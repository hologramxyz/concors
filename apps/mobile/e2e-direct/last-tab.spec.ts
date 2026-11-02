import { test, expect, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";

test("a launch reopens the last tab, and each workspace keeps its own last tab", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-mobile-last-tab-"));
  const desktop = new DaemonConnection({
    endpoint: describeDaemonEndpoint(mobileDesktopSocket),
    client: { kind: "desktop", name: "last-tab-acceptance", version: "0.1.0" },
  });
  const unsubscribe = desktop.subscribeWorkspace(() => undefined);
  const execute = async (operation: WorkspaceOperation) => {
    const current = desktop.workspace;
    if (!current) throw new Error("Missing desktop workspace");
    const result = await desktop.executeWorkspace({
      type: "workspace.command",
      commandId: crypto.randomUUID(),
      epoch: current.epoch,
      operation,
    });
    expect(result.outcome.status).toBe("accepted");
  };
  const version = (projectId: string) => {
    const project = desktop.workspace?.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("Missing workspace");
    return project.version;
  };
  const addWorkspace = async (name: string) => {
    const projectId = crypto.randomUUID();
    // A directory belongs to one workspace.
    const root = join(directory, projectId);
    await mkdir(root);
    await execute({ kind: "project.add", projectId, name, directory: root });
    const addTab = async (tab: string) => {
      const tabId = crypto.randomUUID(),
        paneId = crypto.randomUUID();
      await execute({
        kind: "tab.create",
        projectId,
        expectedVersion: version(projectId),
        tabId,
        paneId,
        name: `${name} ${tab}`,
        profile: "shell",
      });
      return { tabId, value: `${tabId}:${paneId}` };
    };
    const first = await addTab("First");
    const second = await addTab("Second");
    return { projectId, firstTab: first.tabId, first: first.value, second: second.value };
  };
  const launch = async (target: Page) => {
    await target.goto("/");
    await target.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    return target.frameLocator('iframe[title="Concors workspace"]');
  };
  try {
    await desktop.connect();
    await expect.poll(() => desktop.workspace).toBeTruthy();
    const alpha = await addWorkspace("Alpha workspace");
    const beta = await addWorkspace("Beta workspace");
    // The desktop's selection is what a launch used to open.
    await execute({ kind: "selection.set", projectId: alpha.projectId, tabId: alpha.firstTab });

    let ui = await launch(page);
    const picker = () =>
      ui.getByRole("combobox", { name: "Tabs", exact: true, includeHidden: true });
    const pick = async (value: string) => {
      await picker().click();
      await ui
        .getByRole("dialog", { name: "Tabs", exact: true })
        .locator(`[data-value="${value}"]`)
        .click();
      await expect(picker()).toHaveAttribute("data-value", value);
    };
    const openWorkspace = async (name: string) => {
      await ui.locator("#mobile-sidebar-toggle").click();
      await ui
        .getByRole("dialog", { name: "Workspace sidebar" })
        .getByRole("button", { name, exact: true })
        .click();
    };
    await expect(picker()).toHaveAttribute("data-value", alpha.first);

    // The last tab survives a launch.
    await pick(alpha.second);
    ui = await launch(page);
    await expect(picker()).toHaveAttribute("data-value", alpha.second);

    // So does the last workspace, even though the desktop still selects the other one.
    await openWorkspace("Beta workspace");
    await expect(picker()).toHaveAttribute("data-value", beta.first);
    await pick(beta.second);
    ui = await launch(page);
    await expect(picker()).toHaveAttribute("data-value", beta.second);

    // Returning to a workspace after a launch finds the tab it was left on, not its first.
    await openWorkspace("Alpha workspace");
    await expect(picker()).toHaveAttribute("data-value", alpha.second);
    ui = await launch(page);
    await expect(picker()).toHaveAttribute("data-value", alpha.second);
  } finally {
    desktop.disconnect();
    unsubscribe();
    await rm(directory, { recursive: true, force: true });
  }
});
