import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import { mockChatHistory } from "../../../e2e/support/chat-history.ts";

for (const native of [false, true]) {
  test(`mobile ${native ? "native bridge" : "web"} automatically loads earlier and newer history`, async ({
    page,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "concors-mobile-history-"));
    const desktop = new DaemonConnection({
      endpoint: describeDaemonEndpoint("ws://127.0.0.1:7440/ws"),
      client: { kind: "desktop", name: "mobile-history-test", version: "0.1.0" },
    });
    const unsubscribe = desktop.subscribeWorkspace(() => undefined);
    const history = await mockChatHistory(page, "**/ws");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await desktop.connect();
      await expect.poll(() => desktop.workspace).toBeTruthy();
      const projectId = crypto.randomUUID(),
        tabId = crypto.randomUUID(),
        paneId = crypto.randomUUID();
      const execute = async (operation: WorkspaceOperation) => {
        const workspace = desktop.workspace;
        if (!workspace) throw new Error("Missing workspace");
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
      await execute({ kind: "project.add", projectId, name: "Mobile history", directory });
      await execute({
        kind: "tab.create",
        projectId,
        expectedVersion: 0,
        tabId,
        paneId,
        name: "History",
        profile: "chat",
      });
      if (native)
        await page.addInitScript(() => {
          window.addEventListener("message", (event) => {
            const message = event.data?.concorsMobile;
            if (window.parent !== window && message?.type === "state") {
              message.state.native = true;
              message.state.nativeChrome = true;
            }
          });
        });
      await page.goto("/");
      await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
      await page.getByRole("button", { name: "Allow AI data sharing", exact: true }).click();
      const ui = page.frameLocator('iframe[title="Concors workspace"]');
      const timeline = ui.getByRole("log", { name: "Chat timeline" });
      await expect(timeline.getByText("History 0 message 639", { exact: true })).toBeVisible();
      await expect(ui.getByRole("heading", { name: "Choose an agent" })).toHaveCount(0);
      await expect(ui.getByRole("button", { name: /Load (earlier|newer) messages/ })).toHaveCount(
        0,
      );
      for (let step = 0; step < 4; step++) {
        await timeline.evaluate((viewport) => {
          viewport.scrollTop = 1;
        });
        await expect(timeline.locator("[data-message-position]").first()).toHaveAttribute(
          "data-message-position",
          String(480 - step * 80),
        );
        expect(await timeline.locator("[data-message-id]").count()).toBeLessThanOrEqual(240);
      }
      for (const last of [559, 639]) {
        await timeline.evaluate((viewport) => {
          viewport.scrollTop = viewport.scrollHeight;
        });
        await expect(timeline.locator("[data-message-position]").last()).toHaveAttribute(
          "data-message-position",
          String(last),
        );
      }
      expect(history.requests.some((request) => request.after !== undefined)).toBe(true);
      await timeline.evaluate((viewport) => {
        viewport.scrollTop = viewport.scrollHeight;
      });
      await expect(ui.getByRole("button", { name: "Latest", exact: true })).toHaveCount(0);
      const release = history.pauseNext("earlier");
      await timeline.evaluate((viewport) => {
        viewport.scrollTop = 1;
      });
      await expect(timeline.getByRole("status")).toContainText("Loading earlier messages");
      history.truncate();
      await expect(timeline.getByText("History 1 message 119", { exact: true })).toBeVisible();
      release();
      await expect(timeline.getByText(/History 0 message/)).toHaveCount(0);
      await page.screenshot({
        path: test.info().outputPath(`mobile-history-${native ? "native" : "web"}.png`),
      });
      expect(errors).toEqual([]);
    } finally {
      desktop.disconnect();
      unsubscribe();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
