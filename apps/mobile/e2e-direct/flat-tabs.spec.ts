import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";

test("flat mobile tabs stay synced with desktop nested splits without flattening their saved layout", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-mobile-flat-tabs-"));
  const desktop = new DaemonConnection({
    endpoint: describeDaemonEndpoint(mobileDesktopSocket),
    client: { kind: "desktop", name: "flat-tabs-acceptance", version: "0.1.0" },
  });
  const unsubscribe = desktop.subscribeWorkspace(() => undefined);
  const projectId = crypto.randomUUID(),
    tabId = crypto.randomUUID(),
    paneId = crypto.randomUUID();
  const second = crypto.randomUUID(),
    third = crypto.randomUUID();
  const notesTab = crypto.randomUUID(),
    notesPane = crypto.randomUUID();
  const snapshot = () => {
    const current = desktop.workspace;
    if (!current) throw new Error("Missing desktop workspace");
    return current;
  };
  const project = () => {
    const current = desktop.workspace?.projects.find((item) => item.id === projectId);
    if (!current) throw new Error("Missing flat tabs project");
    return current;
  };
  const splitTab = () => {
    const current = project().tabs.find((tab) => tab.id === tabId);
    if (!current) throw new Error("Missing split desktop tab");
    return current;
  };
  const execute = async (operation: WorkspaceOperation) => {
    const result = await desktop.executeWorkspace({
      type: "workspace.command",
      commandId: crypto.randomUUID(),
      epoch: snapshot().epoch,
      operation,
    });
    expect(result.outcome.status).toBe("accepted");
  };
  // Session attachment is allowed when opening a view; layout, IDs, profiles and order are not rewritten.
  const layout = () =>
    project().tabs.map((tab) => ({
      ...tab,
      nodes: tab.nodes.map((node) => (node.kind === "pane" ? { ...node, sessionId: null } : node)),
    }));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await desktop.connect();
    await expect.poll(() => desktop.workspace).toBeTruthy();
    await execute({ kind: "project.add", projectId, name: "Flat tabs acceptance", directory });
    await execute({
      kind: "tab.create",
      projectId,
      expectedVersion: project().version,
      tabId,
      paneId,
      name: "Development",
      profile: "chat",
    });
    await execute({
      kind: "pane.split",
      projectId,
      expectedVersion: project().version,
      tabId,
      paneId,
      newPaneId: second,
      splitId: crypto.randomUUID(),
      axis: "horizontal",
      profile: "shell",
    });
    await execute({
      kind: "pane.split",
      projectId,
      expectedVersion: project().version,
      tabId,
      paneId: second,
      newPaneId: third,
      splitId: crypto.randomUUID(),
      axis: "vertical",
      profile: "shell",
    });
    await execute({
      kind: "tab.create",
      projectId,
      expectedVersion: project().version,
      tabId: notesTab,
      paneId: notesPane,
      name: "Notes",
      profile: "chat",
    });
    await execute({ kind: "selection.set", projectId, tabId });
    await page.goto("/");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    await page.getByRole("button", { name: "Allow AI data sharing", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    await ui.getByRole("button", { name: "Codex", exact: true }).click();
    const input = ui.getByRole("textbox", { name: "Message Codex" });
    await input.fill("Keep this draft while switching tabs");
    const picker = ui.getByRole("combobox", { name: "Tabs", exact: true, includeHidden: true });
    const drawer = ui.getByRole("dialog", { name: "Tabs", exact: true });
    const before = layout();
    const selection = { ...snapshot().selection };
    await picker.click();
    await expect(drawer.locator(".mobile-tab-card")).toHaveCount(0);
    await expect(drawer.locator("[data-pane-choice]")).toHaveText([
      "Development · 1Agent",
      "Development · 2Terminal",
      "Development · 3Terminal",
      "NotesAgent",
    ]);
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    for (const value of [
      `${tabId}:${second}`,
      `${tabId}:${third}`,
      `${notesTab}:${notesPane}`,
      `${tabId}:${paneId}`,
    ]) {
      await picker.press("Control+Shift+t");
      await picker.press("ArrowRight");
      await expect(picker).toHaveAttribute("data-value", value);
    }
    await expect(input).toHaveValue("Keep this draft while switching tabs");
    expect(layout()).toEqual(before);
    expect(snapshot().selection).toEqual(selection);
    const session = splitTab().nodes.find((node) => node.id === paneId);
    expect(session?.kind === "pane" && session.sessionId).toBeTruthy();

    // An open drawer updates immediately when desktop changes its existing layout.
    await picker.click();
    await execute({
      kind: "tab.rename",
      projectId,
      expectedVersion: project().version,
      tabId,
      name: "Renamed on desktop",
    });
    await expect(drawer.locator("[data-pane-choice]").first()).toContainText(
      "Renamed on desktop · 1",
    );
    const fourth = crypto.randomUUID();
    await execute({
      kind: "pane.split",
      projectId,
      expectedVersion: project().version,
      tabId: notesTab,
      paneId: notesPane,
      newPaneId: fourth,
      splitId: crypto.randomUUID(),
      axis: "horizontal",
      profile: "shell",
    });
    await expect(drawer.locator("[data-pane-choice]")).toHaveCount(5);
    await execute({
      kind: "pane.close",
      projectId,
      expectedVersion: project().version,
      tabId: notesTab,
      paneId: fourth,
    });
    await expect(drawer.locator("[data-pane-choice]")).toHaveCount(4);

    // New mobile tabs are single-pane desktop tabs, not additional splits.
    const originalLayout = layout();
    await drawer.getByRole("button", { name: "New tab", exact: true }).click();
    const create = ui.getByRole("dialog", { name: "New tab", exact: true });
    await expect(create.getByRole("button", { name: /Add pane/ })).toHaveCount(0);
    await create.getByRole("button", { name: "Agent", exact: true }).click();
    await expect.poll(() => project().tabs.length).toBe(3);
    const added = project().tabs[2];
    if (!added) throw new Error("Missing newly created tab");
    expect(added.nodes).toHaveLength(1);
    expect(layout().slice(0, 2)).toEqual(originalLayout);
    await expect(picker).toHaveAttribute("data-value", `${added.id}:${added.root}`);
    await picker.click();
    await drawer.locator(`[data-value="${tabId}:${paneId}"]`).click();
    await expect(input).toHaveValue("Keep this draft while switching tabs");

    // An inactive row changes only its own leaf, not the active view or sibling sessions.
    await picker.click();
    const row = drawer.locator(`.mobile-pane-row:has([data-value="${tabId}:${second}"])`);
    await row.getByRole("button", { name: /^Actions for tab / }).click();
    await expect(ui.getByRole("menuitem", { name: "Rename tab", exact: true })).toHaveCount(0);
    await ui.getByRole("menuitemradio", { name: "OpenCode", exact: true }).click();
    await expect
      .poll(() => {
        const node = splitTab().nodes.find((node) => node.id === second);
        return node?.kind === "pane" ? node.profile : null;
      })
      .toBe("opencode");
    await row.getByRole("button", { name: /^Actions for tab / }).click();
    await ui.getByRole("menuitem", { name: "Close tab…", exact: true }).click();
    await ui.getByRole("button", { name: "Close tab", exact: true }).click();
    await expect(picker).toHaveAttribute("data-value", `${tabId}:${paneId}`);
    await expect.poll(() => splitTab().nodes.some((node) => node.id === second)).toBe(false);
    expect(splitTab().nodes.find((node) => node.id === paneId)).toEqual(session);
    expect(splitTab().nodes.some((node) => node.id === third)).toBe(true);
    await expect(input).toHaveValue("Keep this draft while switching tabs");

    // Closing the active leaf leaves its sibling open; closing a last leaf removes only its empty parent.
    await picker.press("Control+Shift+t");
    await picker.press("Backspace");
    await ui.getByRole("button", { name: "Close tab", exact: true }).click();
    await expect(picker).toHaveAttribute("data-value", `${tabId}:${third}`);
    await picker.click();
    await drawer.locator(`[data-value="${added.id}:${added.root}"]`).click();
    await picker.press("Control+Shift+t");
    await picker.press("Backspace");
    await ui.getByRole("button", { name: "Close tab", exact: true }).click();
    await expect.poll(() => project().tabs.map((tab) => tab.id)).toEqual([tabId, notesTab]);
    await expect(picker).toHaveAttribute("data-value", `${tabId}:${third}`);
    expect(errors).toEqual([]);
  } finally {
    desktop.disconnect();
    unsubscribe();
    await rm(directory, { recursive: true, force: true });
  }
});
