import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";

test("mobile shows workspace pull request counts and opens a workspace's pull requests", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-mobile-pull-requests-"));
  const desktop = new DaemonConnection({
    endpoint: describeDaemonEndpoint(mobileDesktopSocket),
    client: { kind: "test", name: "pull-request-parity", version: "0.1.0" },
  });
  desktop.subscribeWorkspace(() => undefined);
  try {
    for (const [name, remote] of [
      ["app", "git@github.com:hologram/app.git"],
      ["site", "https://github.com/hologram/site.git"],
    ] as const) {
      execFileSync("git", ["init", "--quiet", join(directory, name)]);
      execFileSync("git", ["-C", join(directory, name), "remote", "add", "origin", remote]);
    }
    await desktop.connect();
    await expect.poll(() => desktop.workspace).not.toBeNull();
    const workspace = desktop.workspace;
    if (!workspace) throw new Error("Missing workspace");
    await desktop.executeWorkspace({
      type: "workspace.command",
      commandId: crypto.randomUUID(),
      epoch: workspace.epoch,
      operation: {
        kind: "project.add",
        projectId: crypto.randomUUID(),
        name: "Hologram",
        directory,
      },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await expect(ui.getByRole("button", { name: "Pull requests", exact: true })).toContainText("3");
    const count = ui.getByRole("button", { name: "3 open pull requests in Hologram" });
    await expect(count).toHaveText("3");
    await page.screenshot({ path: test.info().outputPath("pull-requests-mobile-sidebar.png") });
    await count.click();
    await expect(ui.getByRole("heading", { name: "Pull requests", level: 1 })).toBeVisible();
    await expect(ui.getByRole("article", { name: "hologram/app" })).toContainText(
      "Show pull requests in workspaces",
    );
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const main = ui.locator("main");
      expect(await main.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath("pull-requests-mobile-page.png") });
    await ui.getByRole("button", { name: /^Show pull requests in workspaces/ }).click();
    const view = ui.getByRole("article", { name: "Pull request #42" });
    await expect(view.getByRole("region", { name: "Merge status" })).toContainText(
      "Ready to merge",
    );
    await expect(view.getByRole("button", { name: "Merge…" })).toBeVisible();
    await expect(view.getByRole("button", { name: "Close…" })).toBeVisible();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const main = ui.locator("main");
      expect(await main.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath("pull-request-mobile-detail.png") });
    await view.getByRole("button", { name: "Merge…" }).click();
    await expect(ui.getByRole("dialog", { name: "Merge pull request #42?" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("pull-request-mobile-merge.png") });
  } finally {
    desktop.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
