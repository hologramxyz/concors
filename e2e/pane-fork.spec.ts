import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentControlsSchema, type AgentInfo } from "../packages/protocol/src/index.ts";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("a chat pane's menu forks the whole chat", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-fork-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The test provider cannot fork, so the chat is told it can, and the request is only recorded.
  const forkable = (agent?: AgentInfo) => {
    if (agent) agent.controls = AgentControlsSchema.parse({ ...agent.controls, fork: true });
  };
  const forks: unknown[] = [];
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "agent.request" && message.operation?.kind === "fork-session")
        forks.push(message.operation);
      else server.send(raw);
    });
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "agent.state") forkable(message.agent);
      if (message.type === "agent.list") message.agents.forEach(forkable);
      if (message.type === "agent.result") forkable(message.outcome.conversation?.agent);
      socket.send(JSON.stringify(message));
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Fork from the pane", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    await composer.fill("Something worth forking");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Hello from");

    await page.getByRole("button", { name: "Pane actions", exact: true }).click();
    const fork = page.getByRole("menuitem", { name: "Fork chat", exact: true });
    await expect(fork).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath("pane-menu-fork.png") });
    await fork.click();
    // The whole chat: no turn, unlike a reply's own "Fork from here".
    await expect.poll(() => forks).toHaveLength(1);
    expect(forks[0]).toMatchObject({ kind: "fork-session", sessionId: expect.any(String) });
    expect(forks[0]).not.toHaveProperty("turnId");
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
