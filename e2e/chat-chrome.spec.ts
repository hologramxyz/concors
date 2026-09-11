import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentControlsSchema, type AgentInfo } from "../packages/protocol/src/index.ts";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("chat stays uncluttered even when the provider advertises session tools and commands", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-chat-chrome-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let advertised = false;
  let accountRead = false;
  const addControls = (agent?: AgentInfo) => {
    if (!agent) return;
    advertised = true;
    agent.controls = AgentControlsSchema.parse({
      ...agent.controls,
      importSessions: true,
      fork: true,
      rewind: ["conversation"],
      mcpStatus: true,
      commands: [{ name: "compact", description: "Compact the conversation context" }],
    });
  };
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "agent.state") addControls(message.agent);
      if (message.type === "agent.list") message.agents.forEach(addControls);
      if (message.type === "agent.result") {
        addControls(message.outcome.conversation?.agent);
        if (message.outcome.account) {
          // The test backend is connection-scoped; model an existing CLI login across reloads.
          accountRead = true;
          message.outcome.account.status = "connected";
          message.outcome.account.label = "fixture-account@example.test";
        }
      }
      socket.send(JSON.stringify(message));
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Clean chat", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    await expect(page.getByRole("region", { name: "Codex account connection" })).toHaveCount(0);
    await composer.fill("Keep the conversation controls simple");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from");
    expect(advertised).toBe(true);
    expect(accountRead).toBe(true);
    const checkControls = async () => {
      await expect(page.getByRole("region", { name: "Codex account connection" })).toHaveCount(0);
      await expect(page.getByText("fixture-account@example.test", { exact: false })).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: "Codex connected" })).toHaveCount(0);
      for (const name of [
        "Import session",
        "Fork session",
        "Rewind",
        "MCP servers",
        "Agent commands",
      ])
        await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
      for (const name of ["Agent and model", "Thinking effort", "Permission mode"])
        await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
    };
    await checkControls();
    await page.screenshot({ path: test.info().outputPath("clean-chat-desktop.png") });
    await page.reload();
    await expect(composer).toBeEnabled();
    await checkControls();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(composer).toBeVisible();
    await checkControls();
    await expect
      .poll(async () => {
        const box = await composer.boundingBox();
        return box ? box.x + box.width : Infinity;
      })
      .toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath("clean-chat-narrow.png") });
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
