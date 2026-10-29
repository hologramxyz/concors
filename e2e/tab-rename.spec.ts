import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";
import { tab } from "./support/tabs.ts";

test("double-clicking a tab renames it inline, and the name persists and syncs", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-rename-"));
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");
    await seedProject(page, "Renamable tabs", directory);
    const tabs = page.getByLabel("Project tabs", { exact: true });
    const labels = () => tabs.locator("[data-tab-id] > button:first-child").allTextContents();
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    // Unnamed tabs show their pane's title: the shell's, and the chat's until it is titled.
    await expect.poll(labels).toEqual(["Terminal", "New chat"]);

    // Double-click opens an inline editor with the shown title selected; Enter commits.
    await tab(page, 1).dblclick();
    const editor = tabs.getByRole("textbox", { name: "Tab name", exact: true });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("New chat");
    await page.keyboard.type("Research agent");
    await page.keyboard.press("Enter");
    await expect(editor).toHaveCount(0);
    await expect.poll(labels).toEqual(["Terminal", "Research agent"]);

    // Escape discards, an empty name is ignored, and the editor never lingers.
    await tab(page, 0).dblclick();
    await page.keyboard.type("Not this");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await tab(page, 0).dblclick();
    await editor.fill("   ");
    await page.keyboard.press("Enter");
    await expect.poll(labels).toEqual(["Terminal", "Research agent"]);

    // Keeping the title it already shows leaves the tab unnamed, so it still follows its pane.
    await tab(page, 0).dblclick();
    await expect(editor).toHaveValue("Terminal");
    await page.keyboard.press("Enter");
    await expect(editor).toHaveCount(0);
    const terminal = page.getByRole("region", { name: "Terminal pane", exact: true });
    await terminal.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Rename pane" }).click();
    await terminal.getByRole("textbox", { name: "Pane name", exact: true }).fill("Logs");
    await page.keyboard.press("Enter");
    await expect.poll(labels).toEqual(["Logs", "Research agent"]);

    // F2 on a focused tab also renames; clicking elsewhere commits.
    await tab(page, 0).focus();
    await page.keyboard.press("F2");
    await expect(editor).toBeFocused();
    await page.keyboard.type("Shell work");
    await page.getByLabel("Project tabs", { exact: true }).click({ position: { x: 1, y: 1 } });
    await expect.poll(labels).toEqual(["Shell work", "Research agent"]);

    // Custom names survive a reload and reach another client.
    await page.reload();
    await expect.poll(labels).toEqual(["Shell work", "Research agent"]);
    await second.goto(test.info().project.use.baseURL ?? "http://localhost:1420");
    await expect(
      second
        .getByLabel("Project tabs", { exact: true })
        .getByRole("button", { name: "Research agent", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a pane is renamed from its title or its menu, and clearing the name restores the default", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-rename-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Renamable panes", directory);
    const pane = page.locator("section[data-pane-id]").first();
    const header = pane.locator("header");
    const editor = pane.getByRole("textbox", { name: "Pane name", exact: true });
    await expect(header).toContainText("Terminal");

    // The header can show before the machine says panes are renamable; its title says once they are.
    const title = header.getByText("Terminal", { exact: true });
    await expect(title).toHaveAttribute("title", /Double-click to rename/);
    await title.dblclick();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("Terminal");
    await page.keyboard.type("Dev server");
    await page.keyboard.press("Enter");
    await expect(editor).toHaveCount(0);
    await expect(header.getByText("Dev server", { exact: true })).toBeVisible();

    // The name is shared workspace state, so it survives a reload.
    await page.reload();
    await expect(header.getByText("Dev server", { exact: true })).toBeVisible();

    await pane.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Rename pane" }).click();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("Dev server");
    await editor.fill("");
    await page.keyboard.press("Enter");
    await expect(header.getByText("Terminal", { exact: true })).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an agent is renamed from the sidebar, and its pane title follows", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-agent-rename-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Renamable agents", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    // The chat's row under its workspace: renaming it names its pane, so the tab follows too.
    const agents = page.getByRole("list", { name: "Renamable agents tabs", exact: true });
    const row = agents
      .getByRole("listitem")
      .filter({ has: page.locator("button[data-agent-id]") })
      .first();
    const title = page
      .getByRole("region", { name: "Agent pane", exact: true })
      .locator("header .truncate");
    const editor = agents.getByRole("textbox", { name: "Tab name", exact: true });
    await expect(row.locator("button[data-agent-id]")).toBeVisible();
    const original = await row.locator("button[data-agent-id] .truncate").innerText();
    await expect(title).toHaveText(original);

    await row.hover();
    await row.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Rename tab", exact: true }).click();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(original);
    await page.keyboard.type("Release notes");
    await page.keyboard.press("Enter");
    await expect(editor).toHaveCount(0);
    await expect(row.locator("button[data-agent-id] .truncate")).toHaveText("Release notes");
    await expect(title).toHaveText("Release notes");

    // Escape discards; clearing the name gives the agent and its pane their default back.
    await row.hover();
    await row.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Rename tab", exact: true }).click();
    await expect(editor).toBeFocused();
    await page.keyboard.type("Not this");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(title).toHaveText("Release notes");
    await row.hover();
    await row.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Rename tab", exact: true }).click();
    await expect(editor).toBeFocused();
    await editor.fill("");
    await page.keyboard.press("Enter");
    await expect(row.locator("button[data-agent-id] .truncate")).toHaveText(original);
    await expect(title).toHaveText(original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("renaming a new Agent tab keeps focus when its chat becomes ready mid-word", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-rename-race-"));
  // The chat's composer only becomes usable once the daemon says the agent started. Hold those
  // updates while the tab is being named, then let them arrive in the middle of a word.
  let holding = false;
  const held: string[] = [];
  let deliver: ((raw: string) => void) | undefined;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    deliver = (raw) => socket.send(raw);
    socket.onMessage((raw) => server.send(raw));
    server.onMessage((raw) => {
      const type = (JSON.parse(String(raw)) as { type?: string }).type;
      if (holding && (type === "agent.state" || type === "agent.list")) held.push(String(raw));
      else socket.send(raw);
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Renaming while starting", directory);
    const tabs = page.getByLabel("Project tabs", { exact: true });
    holding = true;
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    // The chat picks its provider itself; its start is what is held.
    await tab(page, 1).dblclick();
    const editor = tabs.getByRole("textbox", { name: "Tab name", exact: true });
    await expect(editor).toBeFocused();
    await page.keyboard.type("Res");
    holding = false;
    for (const raw of held.splice(0)) deliver?.(raw);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect(editor).toBeFocused();
    await page.keyboard.type("earch agent");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => tabs.locator("[data-tab-id] > button:first-child").allTextContents())
      .toEqual(["Terminal", "Research agent"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("renaming a new Terminal tab keeps focus when its terminal takes control mid-word", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-rename-terminal-"));
  // A terminal focuses itself once it holds control. Hold the answer to that claim while the tab
  // is being named, then let it arrive in the middle of a word.
  let holding = false;
  const claims = new Set<string>();
  const held: string[] = [];
  let deliver: ((raw: string) => void) | undefined;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    deliver = (raw) => socket.send(raw);
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw)) as {
        type?: string;
        requestId?: string;
        operation?: { kind?: string };
      };
      if (holding && event.type === "terminal.request" && event.operation?.kind === "claim")
        claims.add(event.requestId ?? "");
      server.send(raw);
    });
    server.onMessage((raw) => {
      const event = JSON.parse(String(raw)) as { type?: string; requestId?: string };
      if (event.type === "terminal.result" && claims.has(event.requestId ?? ""))
        held.push(String(raw));
      else socket.send(raw);
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Renaming a terminal", directory);
    const tabs = page.getByLabel("Project tabs", { exact: true });
    holding = true;
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await tab(page, 1).dblclick();
    const editor = tabs.getByRole("textbox", { name: "Tab name", exact: true });
    await expect(editor).toBeFocused();
    await page.keyboard.type("Bui");
    holding = false;
    for (const raw of held.splice(0)) deliver?.(raw);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    await expect(editor).toBeFocused();
    await page.keyboard.type("ld");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => tabs.locator("[data-tab-id] > button:first-child").allTextContents())
      .toEqual(["Terminal", "Build"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
