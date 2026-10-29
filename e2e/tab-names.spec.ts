import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";
import { closeTab, tab, tabs } from "./support/tabs.ts";

test("unnamed tabs show their pane's title and keep custom names across pane changes and reloads", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-names-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Named tabs", directory);
    const bar = page.getByLabel("Project tabs", { exact: true });
    const labels = () => bar.locator("[data-tab-id] > button:first-child").allTextContents();
    await expect.poll(labels).toEqual(["Terminal"]);
    for (const [index, profile] of [
      [1, "New chat"],
      [2, "Codex"],
    ] as const) {
      await page.getByRole("button", { name: "New tab options", exact: true }).click();
      await page.getByRole("menuitem", { name: profile, exact: true }).click();
      await expect(tab(page, index)).toHaveAttribute("aria-pressed", "true");
    }
    // A chat is "New chat" until its first message titles it; a terminal profile shows its name.
    await expect.poll(labels).toEqual(["Terminal", "New chat", "Codex"]);
    await tab(page, 0).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename tab", exact: true }).click();
    await page.getByLabel("Tab name", { exact: true }).fill("Build and review");
    await page.keyboard.press("Enter");
    const renamed = bar.getByRole("button", { name: "Build and review", exact: true });
    await renamed.click();
    // Until the switch lands, "Pane actions" still resolves to the previous tab's pane, which
    // then hides.
    await expect(renamed).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Pane actions", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await page.getByRole("button", { name: "Pane actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Split horizontally", exact: true }).click();
    await expect(page.getByRole("region", { name: "Agent pane", exact: true })).toHaveCount(2);
    await expect.poll(labels).toEqual(["Build and review", "New chat", "Codex"]);
    await closeTab(page, 1).click();
    await tab(page, 1).dragTo(renamed);
    await expect.poll(labels).toEqual(["Codex", "Build and review"]);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect.poll(labels).toEqual(["Codex", "Build and review", "Terminal"]);
    await page.reload();
    await expect.poll(labels).toEqual(["Codex", "Build and review", "Terminal"]);
    await mkdir(join(directory, "other"));
    await seedProject(page, "Another workspace", join(directory, "other"));
    await expect.poll(labels).toEqual(["Terminal"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("closing a tab still works when a new pane's session started a moment before", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-close-race-"));
  // A new pane starts its own session as soon as it appears. Hold the workspace update that
  // records which session the pane shows, so the tab is closed from the layout as it looked just
  // before; that update changed nothing a tab close depends on.
  let armed = false;
  let holding = false;
  const held: string[] = [];
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw)) as { type?: string; operation?: { kind?: string } };
      if (armed && event.type === "terminal.request" && event.operation?.kind === "start")
        holding = true;
      server.send(raw);
    });
    server.onMessage((raw) => {
      const type = (JSON.parse(String(raw)) as { type?: string }).type;
      if (holding && type === "workspace.snapshot") held.push(String(raw));
      else if (holding && type === "workspace.result") {
        // The answer to the close: deliver what was held first, in the order it was sent.
        holding = false;
        for (const message of held.splice(0)) socket.send(message);
        socket.send(raw);
      } else socket.send(raw);
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Closing while starting", directory);
    const bar = page.getByLabel("Project tabs", { exact: true });
    const labels = () => bar.locator("[data-tab-id] > button:first-child").allTextContents();
    await expect.poll(labels).toEqual(["Terminal"]);
    armed = true;
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect(tab(page, 1)).toHaveAttribute("aria-pressed", "true");
    const kept = await tabs(page).nth(1).getAttribute("data-tab-id");
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await closeTab(page, 0).click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(tabs(page).first()).toHaveAttribute("data-tab-id", kept ?? "");
    await expect(page.getByText("Project changed on another client")).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
