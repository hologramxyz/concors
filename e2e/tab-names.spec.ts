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
    const labels = () =>
      bar.locator("[data-tab-id] > button:first-child span.truncate").allTextContents();
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

test("a tab with several panes shows the focused pane's one icon and how many panes it has", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-icon-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Tab icon", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    const button = tab(page, 1);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button).toHaveText("Terminal");
    const panes = page.locator("[data-pane-id]").filter({ visible: true });
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally" }).click();
    await expect(panes).toHaveCount(2);
    await expect(button).toHaveText("Terminal2");
    // The count is for the eye; the tab's name stays its name.
    await expect(page.getByRole("button", { name: "Terminal", exact: true })).toHaveCount(2);
    await button.hover();
    await expect(page.getByRole("tooltip")).toHaveText("2 panes");
    await page.mouse.move(0, 0);

    const icon = button.locator("[data-tab-icon-for]");
    await expect(icon).toHaveCount(1);
    for (const index of [0, 1]) {
      await panes.nth(index).locator("textarea").focus();
      await expect(icon).toHaveAttribute(
        "data-tab-icon-for",
        (await panes.nth(index).getAttribute("data-pane-id")) ?? "",
      );
    }
    // Closing the focused pane hands the icon on, and the count goes with the second pane.
    await panes.nth(1).getByRole("button", { name: "Close pane" }).click();
    await expect(panes).toHaveCount(1);
    await expect(icon).toHaveAttribute(
      "data-tab-icon-for",
      (await panes.first().getAttribute("data-pane-id")) ?? "",
    );
    await expect(button).toHaveText("Terminal");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rearranging panes keeps the tab's name, and the name is the oldest pane's", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-tab-stable-name-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Stable name", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    const button = tab(page, 1);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const panes = page.locator("[data-pane-id]").filter({ visible: true });
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally" }).click();
    await expect(panes).toHaveCount(2);
    const rename = async (index: number, name: string) => {
      await panes.nth(index).getByRole("button", { name: "Pane actions" }).click();
      await page.getByRole("menuitem", { name: "Rename pane" }).click();
      await panes.nth(index).getByRole("textbox", { name: "Pane name" }).fill(name);
      await page.keyboard.press("Enter");
      await expect(panes.nth(index).locator("header")).toContainText(name);
    };
    await rename(0, "Oldest");
    await rename(1, "Newest");
    const name = button.locator("span.truncate");
    await expect(name).toHaveText("Oldest");
    const oldest = panes.first();
    const oldestId = await oldest.getAttribute("data-pane-id");

    const dragOnto = async (sx: number, sy: number) => {
      const source = page.locator(`[data-pane-id="${oldestId}"]`);
      const others = panes.filter({ hasNot: page.locator(`[data-pane-id="${oldestId}"]`) });
      const ids = await panes.evaluateAll((all) => all.map((p) => p.getAttribute("data-pane-id")));
      const otherId = ids.find((id) => id !== oldestId);
      const header = await source.locator("header").boundingBox();
      const other = await page.locator(`[data-pane-id="${otherId}"]`).boundingBox();
      if (!header || !other || !(await others.count())) throw new Error("Panes missing");
      await page.mouse.move(header.x + 60, header.y + header.height / 2);
      await page.mouse.down();
      await page.mouse.move(other.x + other.width * sx, other.y + other.height * sy, { steps: 4 });
      await expect(page.getByTestId("pane-drop-preview")).toHaveCount(1);
      await page.mouse.up();
    };
    // A swap puts the other pane first in the layout; the name stays, here and after a reload.
    await dragOnto(0.5, 0.5);
    await expect(panes.first()).not.toHaveAttribute("data-pane-id", oldestId ?? "");
    await expect(name).toHaveText("Oldest");
    await page.reload();
    await expect(tab(page, 1).locator("span.truncate")).toHaveText("Oldest");
    // So does an edge drop.
    await expect(panes).toHaveCount(2);
    await dragOnto(0.1, 0.5);
    await expect(panes.first()).toHaveAttribute("data-pane-id", oldestId ?? "");
    await expect(tab(page, 1).locator("span.truncate")).toHaveText("Oldest");
    await dragOnto(0.9, 0.5);
    await expect(panes.last()).toHaveAttribute("data-pane-id", oldestId ?? "");
    await expect(tab(page, 1).locator("span.truncate")).toHaveText("Oldest");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
