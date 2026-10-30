import { test, expect, type Page } from "@playwright/test";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import type { MobileHostMessage, MobileRendererMessage } from "@concors/client-core";
import { chooseProvider } from "../../../e2e/support/agents.ts";

type TestWindow = Window & {
  nativeSnapshot?: Extract<MobileRendererMessage, { type: "native-surfaces" }>;
  concorsMobileReceive?(message: MobileHostMessage): void;
};

/** Presses a button the phone draws in native chrome, as the native host would. */
async function pressNative(page: Page, label: string) {
  const find = () =>
    page.evaluate(
      (label) =>
        (window as TestWindow).nativeSnapshot?.surfaces.find(
          (item) => item.content.kind === "button" && item.content.label === label,
        )?.id,
      label,
    );
  await expect.poll(find).toBeTruthy();
  const state = await page.evaluate(() => (window as TestWindow).nativeSnapshot);
  const surfaceId = await find();
  const frame = page.frames().find((item) => item !== page.mainFrame());
  if (!state || !surfaceId || !frame) throw new Error(`Missing native surface ${label}`);
  await frame.evaluate((message) => (window as TestWindow).concorsMobileReceive?.(message), {
    type: "native-event",
    scope: state.scope,
    connectionId: state.connectionId,
    surfaceId,
    event: { kind: "press", control: "activate" },
  } satisfies MobileHostMessage);
}

for (const native of [false, true]) {
  test(`mobile ${native ? "native bridge" : "web composer"} resumes a CLI session in a new tab`, async ({
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
            } else if (window.parent === window && message?.type === "native-surfaces") {
              (window as TestWindow).nativeSnapshot = message;
            }
          });
        });
      await page.goto("/");
      await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Allow AI data sharing", exact: true }),
      ).toHaveCount(0);
      const ui = page.frameLocator('iframe[title="Concors workspace"]');
      await chooseProvider(ui);
      // The New tab sheet opens the one Resume a chat list, closed chats and CLI sessions alike.
      // In native chrome the phone draws the Tabs button, so the bridge presses it.
      if (native) await pressNative(page, "Tabs");
      else await ui.getByRole("combobox", { name: "Tabs" }).click();
      await ui.getByRole("button", { name: "New tab", exact: true }).click();
      await ui
        .getByRole("dialog", { name: "New tab", exact: true })
        .getByRole("button", { name: "Resume a closed chat", exact: true })
        .click();
      const dialog = ui.getByRole("dialog", { name: "Resume a chat", exact: true });
      await expect(dialog).toHaveAttribute("data-mobile-drawer", "true");
      await expect(dialog.getByRole("heading")).toHaveCSS("font-size", "16px");
      const search = dialog.getByRole("combobox", { name: "Search chats" });
      await expect(search).toHaveValue("");
      await expect(dialog.getByRole("group")).toHaveCount(0);
      for (const provider of ["codex", "claude", "opencode", "pi"])
        await expect(
          dialog.locator(`[data-resume-row][data-provider="${provider}"]`).first(),
        ).toBeVisible();
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({ path: test.info().outputPath("resume-all-mobile.png") });
      // The shared test daemon uses deterministic native IDs across fixture directories.
      const nativeIndex = native ? 124 : 125;
      // A row resumes its own provider, not the blank chat's Codex default.
      const row = dialog.locator('[data-resume-row][data-provider="claude"]', {
        hasText: `Older CLI session ${nativeIndex}`,
      });
      await expect
        .poll(async () => {
          await dialog.getByRole("listbox", { name: "Chats" }).evaluate((element) => {
            element.scrollTop = element.scrollHeight;
          });
          return row.count();
        })
        .toBe(1);
      await search.fill(`session ${nativeIndex}`);
      await expect(row).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("resume-picker-mobile.png") });
      await row.click();
      await expect(ui.getByRole("log")).toContainText("Saved CLI response");
      // It opens in a new tab beside the chat that was there.
      await expect
        .poll(() => desktop.workspace?.projects.find((p) => p.id === projectId)?.tabs.length)
        .toBe(2);
      const resumed = desktop.agents.find(
        (a) => a.projectId === projectId && a.threadId === `external-thread-${nativeIndex}`,
      );
      expect(resumed?.provider).toBe("claude");
      await page.screenshot({ path: test.info().outputPath("resumed-mobile.png") });
      expect(errors).toEqual([]);
    } finally {
      off();
      desktop.disconnect();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
