import { test, expect } from "@playwright/test";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import { chooseProvider } from "../../../e2e/support/agents.ts";

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
    await page.goto("/");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    // The workspace runs in a frame whose protocol the host relays over its own socket.
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    await chooseProvider(ui);
    const composer = ui.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    await ui.getByLabel("Upload files").setInputFiles([
      { name: "big.txt", mimeType: "text/plain", buffer: Buffer.from("x".repeat(1_500_000)) },
      ...[1, 2, 3].map((n) => ({
        name: `note-${n}.md`,
        mimeType: "text/markdown",
        buffer: Buffer.from(`Note ${n}`),
      })),
    ]);
    await expect(ui.locator('[data-upload="uploaded"]')).toHaveCount(4);
    await composer.fill("Read these");
    await ui.getByRole("button", { name: "Send message", exact: true }).click();
    const sent = ui.getByRole("log").locator("[data-message-attachments]").last();
    await expect(sent.getByRole("button")).toHaveCount(4);
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
      .toBe(4);
    expect(errors).toEqual([]);
  } finally {
    off();
    desktop.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
