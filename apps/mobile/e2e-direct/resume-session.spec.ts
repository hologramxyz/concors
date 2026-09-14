import { test, expect } from "@playwright/test";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";

for (const native of [false, true]) {
  test(`mobile ${native ? "native bridge" : "web composer"} resumes history in the existing pane`, async ({
    page,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "concors-mobile-resume-"));
    const desktop = new DaemonConnection({
      endpoint: describeDaemonEndpoint(mobileDesktopSocket),
      client: { kind: "desktop", name: "mobile-resume-test", version: "0.1.0" },
    });
    const off = desktop.subscribeWorkspace(() => undefined);
    const projectId = crypto.randomUUID(),
      tabId = crypto.randomUUID(),
      paneId = crypto.randomUUID();
    const execute = async (operation: WorkspaceOperation) => {
      const workspace = desktop.workspace;
      if (!workspace) throw new Error("Missing desktop workspace");
      const result = await desktop.executeWorkspace({
        type: "workspace.command",
        commandId: crypto.randomUUID(),
        epoch: workspace.epoch,
        operation,
      });
      expect(result.outcome.status).toBe("accepted");
    };
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await desktop.connect();
      await expect.poll(() => desktop.workspace).toBeTruthy();
      await execute({ kind: "project.add", projectId, name: "Mobile resume", directory });
      await execute({
        kind: "tab.create",
        projectId,
        tabId,
        paneId,
        expectedVersion: 0,
        name: "Tab 1",
        profile: "chat",
      });
      if (native)
        await page.addInitScript(() => {
          window.addEventListener("message", (event) => {
            const message = event.data?.concorsMobile;
            if (window.parent !== window && message?.type === "state") {
              // Exercise the native host contract; Chromium does not render SwiftUI itself.
              message.state.native = true;
              message.state.nativeChrome = true;
            }
          });
        });
      await page.goto("/");
      await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
      await page.getByRole("button", { name: "Allow AI data sharing", exact: true }).click();
      const ui = page.frameLocator('iframe[title="Concors workspace"]');
      await ui.getByRole("button", { name: "Resume session", exact: true }).click();
      const dialog = ui.getByRole("dialog", { name: "Resume session", exact: true });
      await expect(dialog).toHaveAttribute("data-mobile-drawer", "true");
      await dialog.getByRole("combobox", { name: "Session provider" }).selectOption("claude");
      const field = await dialog.getByRole("combobox", { name: "Session provider" }).boundingBox();
      const icon = await dialog.locator("[data-session-provider-icon]").boundingBox();
      expect(field).not.toBeNull();
      expect(icon).not.toBeNull();
      if (field && icon) {
        expect(icon.x).toBeGreaterThan(field.x);
        expect(icon.x + icon.width).toBeLessThan(field.x + field.width);
        expect(icon.y).toBeGreaterThanOrEqual(field.y);
        expect(icon.y + icon.height).toBeLessThanOrEqual(field.y + field.height);
      }
      // The shared test daemon uses deterministic native IDs across fixture directories.
      const nativeIndex = native ? 124 : 125;
      const row = dialog.getByRole("button", {
        name: new RegExp(`^Older CLI session ${nativeIndex} `),
      });
      await dialog.getByRole("textbox", { name: "Search sessions" }).fill(String(nativeIndex));
      await expect(row).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("resume-picker-mobile.png") });
      await row.click();
      await expect(ui.getByRole("log")).toContainText("Saved CLI response");
      await expect(ui.locator(".mobile-pane")).toHaveAttribute("data-pane-id", paneId);
      expect(desktop.workspace?.projects.find((p) => p.id === projectId)?.tabs).toHaveLength(1);
      const resumed = desktop.agents.find(
        (a) => a.projectId === projectId && a.threadId === `external-thread-${nativeIndex}`,
      );
      expect(resumed?.provider).toBe("claude");
      await expect(ui.getByRole("button", { name: "Resume session", exact: true })).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath("resumed-mobile.png") });
      expect(errors).toEqual([]);
    } finally {
      off();
      desktop.disconnect();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
