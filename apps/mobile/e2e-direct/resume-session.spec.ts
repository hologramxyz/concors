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
      await expect(
        page.getByRole("button", { name: "Allow AI data sharing", exact: true }),
      ).toHaveCount(0);
      const ui = page.frameLocator('iframe[title="Concors workspace"]');
      await ui.getByRole("button", { name: "Resume session", exact: true }).click();
      const dialog = ui.getByRole("dialog", { name: "Resume session", exact: true });
      await expect(dialog).toHaveAttribute("data-mobile-drawer", "true");
      await expect(dialog.getByRole("heading")).toHaveCSS("font-size", "16px");
      await expect(dialog.getByRole("textbox", { name: "Search sessions" })).toHaveValue("");
      await expect(dialog.getByRole("combobox")).toHaveCount(0);
      const filters = dialog.getByRole("group", { name: "Filter sessions by provider" });
      await expect(filters.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      for (const provider of ["codex", "claude", "opencode", "pi"]) {
        const row = dialog.locator(`[data-session-provider="${provider}"]`).first();
        await expect(row).toBeVisible();
        await expect(row.locator("[data-session-provider-icon]")).toBeVisible();
        const filter = filters.locator(`[data-session-filter="${provider}"]`);
        await filter.scrollIntoViewIfNeeded();
        await expect(filter.locator("[data-session-filter-icon]")).toBeVisible();
        expect(
          await filter.evaluate((element) => {
            const button = element.getBoundingClientRect();
            const icon = element
              .querySelector("[data-session-filter-icon]")
              ?.getBoundingClientRect();
            return (
              !!icon &&
              icon.left >= button.left &&
              icon.right <= button.right &&
              icon.top >= button.top &&
              icon.bottom <= button.bottom
            );
          }),
        ).toBe(true);
      }
      await filters.evaluate((element) => {
        element.scrollLeft = 0;
      });
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      const actions = dialog.locator('[data-slot="dialog-actions"]');
      await expect(actions.getByRole("button", { name: "Refresh sessions" })).toBeVisible();
      await expect(actions.getByRole("button", { name: "Close", exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("resume-all-mobile.png") });
      if (!native) {
        await filters.getByRole("button", { name: "Claude Code", exact: true }).click();
        await expect(dialog.locator('[data-session-provider="codex"]')).toHaveCount(0);
      }
      // The shared test daemon uses deterministic native IDs across fixture directories.
      const nativeIndex = native ? 124 : 125;
      // A row selected from All must resume its own provider, not the blank chat's Codex default.
      const row = dialog
        .locator('[data-session-provider="claude"]')
        .filter({ hasText: `Older CLI session ${nativeIndex}` });
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
