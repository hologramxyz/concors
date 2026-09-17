import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";

test("mobile manages schedules through the native relay without horizontal overflow", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-mobile-schedules-"));
  const desktop = new DaemonConnection({
    endpoint: describeDaemonEndpoint(mobileDesktopSocket),
    client: { kind: "test", name: "schedule-parity", version: "0.1.0" },
  });
  desktop.subscribeWorkspace(() => undefined);
  try {
    await desktop.connect();
    await expect.poll(() => desktop.workspace).not.toBeNull();
    const workspace = desktop.workspace;
    if (!workspace) throw new Error("Missing workspace");
    const projectId = crypto.randomUUID();
    await desktop.executeWorkspace({
      type: "workspace.command",
      commandId: crypto.randomUUID(),
      epoch: workspace.epoch,
      operation: { kind: "project.add", projectId, name: "Mobile schedules", directory },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Schedules", exact: true }).click();
    await expect(ui.getByRole("heading", { name: "No schedules yet", exact: true })).toBeVisible();
    await ui.getByRole("button", { name: "New schedule", exact: true }).click();
    const dialog = ui.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Mobile review");
    await dialog.getByRole("combobox", { name: "Provider", exact: true }).selectOption("codex");
    await dialog.getByLabel("Model", { exact: true }).fill("fixture");
    await dialog.getByLabel("Prompt", { exact: true }).fill("Review the project");
    await expect(
      dialog.getByRole("button", { name: "Create schedule", exact: true }),
    ).toBeEnabled();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await dialog.getByRole("button", { name: "Create schedule", exact: true }).click();
    await expect.poll(() => desktop.schedules?.[0]?.name).toBe("Mobile review");
    await ui.getByRole("button", { name: "Run Mobile review now", exact: true }).click();
    await expect(ui.getByRole("article").getByRole("status")).toHaveText("Done");
    await ui.getByText("Recent runs · 1", { exact: true }).click();
    await page.screenshot({ path: test.info().outputPath("schedules-mobile.png") });
    await ui.getByRole("button", { name: "Open agent", exact: true }).click();
    await expect(ui.getByRole("log")).toContainText("Review the project");
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Schedules", exact: true }).click();
    await ui.getByRole("button", { name: "Pause Mobile review", exact: true }).click();
    await expect.poll(() => desktop.schedules?.[0]?.enabled).toBe(false);
  } finally {
    desktop.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
