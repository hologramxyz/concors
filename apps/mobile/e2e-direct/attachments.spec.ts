import { test, expect } from "./fixtures";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import { chooseProvider } from "../../../e2e/support/agents.ts";
import { samplePdf } from "../../../e2e/support/pdf";

test("mobile uploads more than three files, and files over 1 MB, through the native host", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-mobile-attachments-"));
  const desktop = new DaemonConnection({
    endpoint: describeDaemonEndpoint(mobileDesktopSocket),
    client: { kind: "desktop", name: "mobile-attachments-test", version: "0.1.0" },
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
    await execute({ kind: "project.add", projectId, name: "Mobile attachments", directory });
    await execute({
      kind: "tab.create",
      projectId,
      tabId,
      paneId,
      expectedVersion: 0,
      name: "Tab 1",
      profile: "chat",
    });
    await page.goto("/?view=workspaces");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    // The workspace runs in a frame whose protocol the host relays over its own socket.
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    await chooseProvider(ui);
    const composer = ui.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    // A wide screenshot-like image, drawn in the page so it is a real PNG.
    const banner = await composer.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 600;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D canvas");
      context.fillStyle = "#3b6ea5";
      context.fillRect(0, 0, 1200, 600);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode")))),
      );
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await ui.getByLabel("Upload files").setInputFiles([
      { name: "banner.png", mimeType: "image/png", buffer: Buffer.from(banner) },
      { name: "big.txt", mimeType: "text/plain", buffer: Buffer.from("x".repeat(1_500_000)) },
      { name: "brief.pdf", mimeType: "application/pdf", buffer: samplePdf() },
      ...[1, 2, 3].map((n) => ({
        name: `note-${n}.md`,
        mimeType: "text/markdown",
        buffer: Buffer.from(`Note ${n}`),
      })),
    ]);
    await expect(ui.locator('[data-upload="uploaded"]')).toHaveCount(6, { timeout: 15_000 });
    await composer.fill("Read these");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    const sent = ui.getByRole("log").locator("[data-message-attachments]").last();
    await expect(sent.getByRole("button")).toHaveCount(6);
    // Another client of the machine sees the same message with every file.
    await expect
      .poll(async () => {
        const agent = desktop.agents.find((a) => a.projectId === projectId);
        if (!agent) return null;
        const read = await desktop.requestAgent(
          { kind: "read", sessionId: agent.id },
          crypto.randomUUID(),
        );
        return read.outcome.status === "ok"
          ? read.outcome.conversation.items.find((i) => i.kind === "user")?.attachments?.length
          : null;
      })
      .toBe(6);
    await sent.getByRole("button", { name: "brief.pdf", exact: true }).click();
    const preview = ui.getByRole("dialog", { name: "brief.pdf", exact: true });
    const firstPage = preview.getByLabel("Page 1", { exact: true });
    await expect
      .poll(
        () =>
          firstPage.evaluate((canvas: HTMLCanvasElement) => {
            if (!canvas.width) return false;
            const pixel = canvas
              .getContext("2d")
              ?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
            return (pixel?.[0] ?? 0) > 200 && (pixel?.[1] ?? 255) < 60;
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
    await preview.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(
      preview.getByRole("button", { name: "Zoom 110%, reset to fit", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("mobile-pdf-attachment.png") });
    await preview.getByRole("button", { name: "Close attachment", exact: true }).click();
    await expect(preview).toHaveCount(0);

    // An image opens over the whole screen, not in a sheet, and fingers zoom it.
    await sent.getByRole("button", { name: "Open banner.png", exact: true }).tap();
    const viewer = ui.locator('[data-image-viewer="fullscreen"]');
    await expect(viewer).toBeVisible();
    await expect(ui.getByRole("dialog", { name: "banner.png", exact: true })).toBeVisible();
    const box = async (locator: {
      boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
    }) => {
      const found = await locator.boundingBox();
      if (!found) throw new Error("Not on screen");
      return found;
    };
    const screen = await box(page.locator('iframe[title="Concors workspace"]'));
    await expect
      .poll(async () => (await viewer.boundingBox())?.height)
      .toBeCloseTo(screen.height, 0);
    expect((await box(viewer)).width).toBeCloseTo(screen.width, 0);
    const image = viewer.getByRole("img", { name: "banner.png", exact: true });
    // Fitted to the screen's width, as wide as the screen.
    await expect.poll(async () => (await image.boundingBox())?.width).toBeCloseTo(screen.width, 0);
    const area = await box(viewer.locator("[data-zoomable-image]"));
    const centre = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    await page.touchscreen.tap(centre.x, centre.y);
    await page.touchscreen.tap(centre.x, centre.y);
    await expect(image).toHaveAttribute("style", /scale\(2\.5\)/);
    await page.screenshot({ path: test.info().outputPath("mobile-image-zoomed.png") });
    await page.touchscreen.tap(centre.x, centre.y);
    await page.touchscreen.tap(centre.x, centre.y);
    await expect(image).toHaveAttribute("style", /scale\(1\)/);
    // Two fingers spreading from 60px to 180px apart triple it.
    const touch = await page.context().newCDPSession(page);
    const fingers = (gap: number) => [
      { x: centre.x - gap / 2, y: centre.y, id: 0 },
      { x: centre.x + gap / 2, y: centre.y, id: 1 },
    ];
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(60) });
    for (const gap of [90, 120, 150, 180])
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: fingers(gap),
      });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(image).toHaveAttribute("style", /scale\(3\)/);
    await ui.getByRole("button", { name: "Close image", exact: true }).tap();
    await expect(viewer).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    off();
    desktop.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
