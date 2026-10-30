import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";
import { tabs } from "./support/tabs.ts";

test("a workspace shows what its agents want while another workspace is open", async ({ page }) => {
  const first = await mkdtemp(join(tmpdir(), "concors-attention-a-"));
  const second = await mkdtemp(join(tmpdir(), "concors-attention-b-"));
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "workspace attention", version: "0.0.0" },
  });
  try {
    control.subscribeWorkspace(() => undefined);
    await control.connect();
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Attention A", first);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect
      .poll(() => control.workspace?.projects.find((p) => p.directory === first)?.id)
      .toBeTruthy();
    const project = control.workspace?.projects.find((p) => p.directory === first);
    assert(project);
    await expect.poll(() => control.agents.some((a) => a.projectId === project.id)).toBe(true);
    const agent = control.agents.find((a) => a.projectId === project.id);
    assert(agent);

    await seedProject(page, "Attention B", second);
    await page.getByRole("button", { name: "Attention B", exact: true }).click();
    const badge = page.locator(`[data-workspace-id="${project.id}"] [data-workspace-attention]`);
    await expect(badge).toHaveCount(0);

    // The agent finishes while workspace B is open: A says so until someone looks.
    await control.requestAgent({ kind: "send", sessionId: agent.id, text: "hello" }, randomUUID());
    await expect(badge).toHaveAttribute("data-workspace-attention", "done");
    await page.getByRole("button", { name: "Attention A", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toContainText("Agents: 1 done");
    await page.screenshot({ path: test.info().outputPath("workspace-attention.png") });
    await page.getByRole("button", { name: "Attention A", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from Codex");
    await expect(badge).toHaveCount(0);

    // A question outranks everything else, and stays until it is answered.
    await page.getByRole("button", { name: "Attention B", exact: true }).click();
    await control.requestAgent(
      { kind: "send", sessionId: agent.id, text: "question" },
      randomUUID(),
    );
    await expect(badge).toHaveAttribute("data-workspace-attention", "needs_input");
  } finally {
    control.disconnect();
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test("a pane shows its agent's status on its own icon, as its tab does", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-status-"));
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "pane status", version: "0.0.0" },
  });
  try {
    control.subscribeWorkspace(() => undefined);
    await control.connect();
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Pane status", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect
      .poll(() => control.workspace?.projects.find((p) => p.directory === directory)?.id)
      .toBeTruthy();
    const project = control.workspace?.projects.find((p) => p.directory === directory);
    assert(project);
    await expect.poll(() => control.agents.some((a) => a.projectId === project.id)).toBe(true);
    const agent = control.agents.find((a) => a.projectId === project.id);
    assert(agent);

    const pane = page.getByRole("region", { name: "Agent pane", exact: true }).locator("header");
    const tab = tabs(page).nth(1).locator("> button").first();
    for (const [text, status] of [
      ["hold", "Working"],
      ["question", "Needs input"],
    ] as const) {
      if (text === "question") {
        const turnId = control.agents.find((a) => a.id === agent.id)?.turnId;
        assert(turnId);
        await control.requestAgent(
          { kind: "interrupt", sessionId: agent.id, turnId },
          randomUUID(),
        );
      }
      await control.requestAgent({ kind: "send", sessionId: agent.id, text }, randomUUID());
      // The pane's icon carries the same badge as the tab's, from the same status.
      await expect(pane.getByRole("img", { name: `Agent status: ${status}` })).toBeVisible();
      await expect(tab).toHaveAttribute("aria-description", `Codex: ${status}`);
    }
  } finally {
    control.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
