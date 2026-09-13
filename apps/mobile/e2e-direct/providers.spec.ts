import { test, expect } from "@playwright/test";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import type {
  MobileHostMessage,
  MobileRendererMessage,
  NativeSurfaceEvent,
} from "@concors/client-core";

type Snapshot = Extract<MobileRendererMessage, { type: "native-surfaces" }>;
type TestWindow = Window & {
  providerSnapshot?: Snapshot;
  concorsMobileReceive?(message: MobileHostMessage): void;
};

for (const native of [false, true]) {
  test(`mobile ${native ? "native bridge" : "web composer"} switches providers without losing prior chats`, async ({
    page,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "concors-mobile-provider-"));
    const desktop = new DaemonConnection({
      endpoint: describeDaemonEndpoint(mobileDesktopSocket),
      client: { kind: "desktop", name: "mobile-provider-acceptance", version: "0.1.0" },
    });
    const unsubscribe = desktop.subscribeWorkspace(() => undefined);
    const projectId = crypto.randomUUID(),
      tabId = crypto.randomUUID(),
      paneId = crypto.randomUUID();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const snapshot = () => page.evaluate(() => (window as TestWindow).providerSnapshot);
    const surface = async (kind: "composer" | "button", label = "") =>
      (await snapshot())?.surfaces.find(
        (item) =>
          item.content.kind === kind &&
          (item.content.kind === "composer" || item.content.label === label),
      );
    const nativeEvent = async (event: NativeSurfaceEvent, label?: string) => {
      if (event.kind === "press" && event.control === "model") {
        await expect
          .poll(async () => {
            const content = (await surface("composer"))?.content;
            return (
              content?.kind === "composer" &&
              content.controls.find((control) => control.id === "model")?.disabled
            );
          })
          .toBe(false);
      }
      const state = await snapshot();
      const target = await surface(label ? "button" : "composer", label);
      const frame = page.frames().find((item) => item !== page.mainFrame());
      if (!state || !target || !frame) throw new Error("Missing native surface");
      await frame.evaluate((message) => (window as TestWindow).concorsMobileReceive?.(message), {
        type: "native-event",
        scope: state.scope,
        connectionId: state.connectionId,
        surfaceId: target.id,
        event,
      } satisfies MobileHostMessage);
    };
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
    try {
      await desktop.connect();
      await expect.poll(() => desktop.workspace).toBeTruthy();
      await execute({ kind: "project.add", projectId, name: "Provider parity", directory });
      const project = desktop.workspace?.projects.find((item) => item.id === projectId);
      if (!project) throw new Error("Missing test project");
      await execute({
        kind: "tab.create",
        projectId,
        expectedVersion: project.version,
        tabId,
        paneId,
        name: "Original chat",
        profile: "chat",
      });
      if (native)
        await page.addInitScript(() => {
          window.addEventListener("message", (event) => {
            const message = event.data?.concorsMobile;
            if (window.parent !== window && message?.type === "state") {
              // Contract test only: Chromium does not render SwiftUI or the native text field.
              message.state.native = true;
              message.state.nativeChrome = true;
            } else if (window.parent === window && message?.type === "native-surfaces") {
              (window as TestWindow).providerSnapshot = message;
            }
          });
        });
      await page.goto("/");
      await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
      await expect(page.getByText(/OpenCode, Pi and custom agents/)).toBeVisible();
      const ui = page.frameLocator('iframe[title="Concors workspace"]');
      let sequence = 0;
      const send = async (label: string, text: string) => {
        if (native) {
          await expect
            .poll(async () => {
              const content = (await surface("composer"))?.content;
              return (
                content?.kind === "composer" &&
                content.editable &&
                content.controls.find((control) => control.id === "model")?.label
              );
            })
            .toBe(`${label} · Agent and model`);
          await nativeEvent({ kind: "focus", focused: true });
          await nativeEvent({ kind: "text", text, sequence: ++sequence });
          await expect
            .poll(async () => {
              const content = (await surface("composer"))?.content;
              return content?.kind === "composer" && content.canSend;
            })
            .toBe(true);
          await nativeEvent({ kind: "press", control: "send", text });
        } else {
          await ui.getByRole("textbox", { name: `Message ${label}`, exact: true }).fill(text);
          await ui.getByRole("button", { name: "Send message", exact: true }).click();
        }
        await expect(ui.getByRole("log")).toContainText(text);
        await expect(ui.getByRole("log")).toContainText("Hello from");
      };
      const choose = async (provider: string, label: string) => {
        const modelId = provider === "codex" ? "fixture" : `fixture-${provider}`;
        const modelLabel = provider === "codex" ? "Fixture model" : `Fixture ${provider} model`;
        if (native) {
          await nativeEvent({ kind: "press", control: "model", value: "__providers__" });
          await expect
            .poll(async () => {
              const content = (await surface("composer"))?.content;
              return (
                content?.kind === "composer" &&
                content.controls
                  .find((item) => item.id === "model")
                  ?.options?.some((option) => option.id === provider)
              );
            })
            .toBe(true);
          await nativeEvent({ kind: "press", control: "model", value: provider });
          await expect
            .poll(async () => {
              const content = (await surface("composer"))?.content;
              return (
                content?.kind === "composer" &&
                content.controls
                  .find((item) => item.id === "model")
                  ?.options?.some((option) => option.id === modelId)
              );
            })
            .toBe(true);
          await nativeEvent({ kind: "press", control: "model", value: modelId });
        } else {
          await ui.getByRole("textbox", { name: /^Message / }).click();
          await ui.getByRole("button", { name: "Agent and model", exact: true }).click();
          await ui.getByRole("button", { name: "Back to providers", exact: true }).click();
          await ui.getByRole("option", { name: `${label} Use in this pane`, exact: true }).click();
          await ui.getByRole("option", { name: modelLabel, exact: true }).click();
        }
      };
      await send("Codex", "Keep my original conversation");
      for (const [provider, label] of [
        ["claude", "Claude Code"],
        ["opencode", "OpenCode"],
        ["pi", "Pi"],
      ] as const) {
        await choose(provider, label);
        await expect(ui.locator(".mobile-pane")).toHaveAttribute("data-pane-id", paneId);
        expect(desktop.workspace?.projects.find((p) => p.id === projectId)?.tabs).toHaveLength(1);
        await send(label, `Continue with ${label}`);
        if (native) {
          const content = (await surface("composer"))?.content;
          expect(
            content?.kind === "composer" &&
              content.controls.map((control) => [control.id, control.icon]),
          ).toEqual([
            ["model", provider],
            ["effort", "brain"],
          ]);
        }
        await expect(ui.getByRole("log")).not.toContainText("Keep my original conversation");
        await choose("codex", "Codex");
        await expect(ui.getByRole("log")).toContainText("Keep my original conversation");
        await expect(ui.getByRole("log")).not.toContainText(`Continue with ${label}`);
      }
      for (const name of ["Import session", "Fork session", "Rewind", "MCP servers"])
        await expect(ui.getByRole("button", { name, exact: true })).toHaveCount(0);
      await expect(ui.locator(".mobile-pane")).toHaveAttribute("data-pane-id", paneId);
      await expect(ui.getByRole("log")).toContainText("Keep my original conversation");
      expect(errors).toEqual([]);
    } finally {
      desktop.disconnect();
      unsubscribe();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
