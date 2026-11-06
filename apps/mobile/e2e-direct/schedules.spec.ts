import { test, expect } from "./fixtures";
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
    // The form is a page in place of the list, not a sheet, and Back leaves it unsaved.
    await ui.getByRole("button", { name: "New schedule", exact: true }).click();
    const form = ui.getByRole("form", { name: "New schedule", exact: true });
    await expect(form.getByRole("heading", { name: "New schedule", exact: true })).toBeVisible();
    await expect(ui.getByRole("dialog")).toHaveCount(0);
    await expect(ui.getByRole("heading", { name: "No schedules yet" })).toHaveCount(0);
    await expect(form.getByLabel("Name", { exact: true })).not.toBeFocused();
    await form.getByRole("button", { name: "Schedules", exact: true }).click();
    await expect(ui.getByRole("heading", { name: "No schedules yet", exact: true })).toBeVisible();
    await ui.getByRole("button", { name: "New schedule", exact: true }).click();
    await form.getByLabel("Name", { exact: true }).fill("Mobile review");
    await form.getByRole("combobox", { name: "Provider", exact: true }).click();
    await ui.getByRole("menuitemradio", { name: "Codex", exact: true }).click();
    await form.getByLabel("Model", { exact: true }).fill("fixture");
    await form.getByLabel("Prompt", { exact: true }).fill("Review the project");
    // Files upload through the app's relay to the machine, which keeps them with the schedule.
    await form.getByLabel("Choose files to attach").setInputFiles({
      name: "brief.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("project brief"),
    });
    await expect(form.getByRole("list", { name: "Files" }).getByRole("listitem")).toHaveText([
      "brief.pdf13 B",
    ]);
    await expect(form.getByRole("button", { name: "Create schedule", exact: true })).toBeEnabled();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: test.info().outputPath("schedule-form-page-mobile.png") });
    await form.getByRole("button", { name: "Create schedule", exact: true }).click();
    await expect.poll(() => desktop.schedules?.[0]?.name).toBe("Mobile review");
    expect(desktop.schedules?.[0]?.files).toMatchObject([{ name: "brief.pdf", size: 13 }]);
    await expect(form).toHaveCount(0);
    await ui.getByRole("button", { name: "Run Mobile review now", exact: true }).click();
    await expect(ui.getByRole("article").getByRole("status")).toHaveText("Done");
    await ui.getByText("Recent runs", { exact: true }).click();
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
