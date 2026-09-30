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
      const ui = page.frameLocator('iframe[title="Concors workspace"]');
      const timeline = ui.getByRole("log", { name: "Chat timeline" });
      const scrollToEdge = (edge: "top" | "bottom") =>
        timeline.evaluate((viewport, edge) => {
          // Only user input may leave the bottom; a bare scrollTop write reads as layout churn.
          viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: edge === "top" ? -1 : 1 }));
          viewport.scrollTop = edge === "top" ? 1 : viewport.scrollHeight;
        }, edge);
      await expect(timeline.getByText("History 0 message 639", { exact: true })).toBeVisible();
      await expect(ui.getByRole("heading", { name: "Choose an agent" })).toHaveCount(0);
      for (const name of [
        "Import session",
        "Fork session",
        "Rewind",
        "MCP servers",
        "Agent commands",
      ])
        await expect(ui.getByRole("button", { name, exact: true })).toHaveCount(0);
      await expect(ui.getByRole("button", { name: /Load (earlier|newer) messages/ })).toHaveCount(
        0,
      );
      for (let step = 0; step < 4; step++) {
        await scrollToEdge("top");
        await expect(timeline.locator("[data-message-position]").first()).toHaveAttribute(
          "data-message-position",
          String(480 - step * 80),
        );
        expect(await timeline.locator("[data-message-id]").count()).toBeLessThanOrEqual(240);
      }
      for (const last of [559, 639]) {
        await scrollToEdge("bottom");
        await expect(timeline.locator("[data-message-position]").last()).toHaveAttribute(
          "data-message-position",
          String(last),
        );
      }
      expect(history.requests.some((request) => request.after !== undefined)).toBe(true);
      for (const position of [0, 639]) {
        await ui.getByRole("button", { name: "Browse your messages", exact: true }).click();
        const dialog = ui.getByRole("dialog", { name: "Your messages", exact: true });
        await dialog
          .getByRole("button", {
            name: `${position + 1} History 0 message ${position}`,
            exact: true,
          })
          .click();
        await expect(
          timeline.getByText(`History 0 message ${position}`, { exact: true }),
        ).toBeInViewport();
        expect(await timeline.locator("[data-message-id]").count()).toBeLessThanOrEqual(240);
      }
      await scrollToEdge("bottom");
      await expect(ui.getByRole("button", { name: "Latest", exact: true })).toHaveCount(0);
      const release = history.pauseNext("earlier");
      await scrollToEdge("top");
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
