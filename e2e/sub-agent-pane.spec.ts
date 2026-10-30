import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("a sub-agent's conversation opens beside its chat, read-only, and follows it live", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-sub-agent-pane-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Sub-agents", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    // "hold" keeps the turn, and so the sub-agent it started, running.
    await composer.fill("rich hold");
    await page.getByRole("button", { name: "Send message", exact: true }).click();

    const row = page.getByLabel("Sub-agent activity");
    await expect(row).toContainText("Check the test coverage");
    await row.getByRole("button", { name: "Open agent conversation", exact: true }).click();

    const panel = page.getByRole("complementary", { name: "Sub-agent conversation" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("status").filter({ hasText: "Working" }).first()).toBeVisible();
    const timeline = panel.getByRole("log", { name: "Sub-agent timeline" });
    // Drawn as the chat draws its own: the prompt, then the command it ran.
    await expect(timeline).toContainText("Check the test coverage");
    await expect(timeline).toContainText("rg --files tests");
    // Read again while it works: its reply arrives without reopening anything.
    await expect(timeline).toContainText("Coverage is 82%.", { timeout: 10_000 });
    await expect(timeline.locator("strong")).toHaveText("82%");
    // Read-only: no composer of its own, and the chat's stays usable beside it.
    await expect(panel.getByRole("textbox")).toHaveCount(0);
    await expect(composer).toBeVisible();

    // A wide pane shows both side by side.
    const chatBox = await page.getByRole("log", { name: "Chat timeline" }).boundingBox();
    const panelBox = await panel.boundingBox();
    if (!chatBox || !panelBox) throw new Error("Chat or panel missing");
    expect(panelBox.x).toBeGreaterThanOrEqual(chatBox.x + chatBox.width - 1);
    await page.screenshot({ path: test.info().outputPath("sub-agent-wide.png") });

    // A narrow one shows the sub-agent over the chat instead of squeezing both.
    await page.setViewportSize({ width: 700, height: 850 });
    await expect
      .poll(async () => {
        const [pane, chat] = await Promise.all([
          panel.boundingBox(),
          page.locator(".chat-with-sub-agent").boundingBox(),
        ]);
        return pane && chat ? Math.round(chat.width - pane.width) : -1;
      })
      .toBe(0);
    await page.screenshot({ path: test.info().outputPath("sub-agent-narrow.png") });

    await timeline.click();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(row).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a sub-agent sent to the background stays live after its turn ends, until it reports back", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-background-sub-agent-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Background sub-agents", directory);
    await page.getByRole("button", { name: "New tab options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    await composer.fill("background");
    await page.getByRole("button", { name: "Send message", exact: true }).click();

    // The turn that started it is over, yet the sub-agent is still working.
    await expect(page.getByText(/^Worked for /)).toBeVisible();
    const row = page.getByLabel("Sub-agent activity");
    await expect(row).toHaveAttribute("aria-busy", "true");
    await expect(row).toHaveAttribute("data-tool-status", "running");
    // Its steps keep arriving after the turn ended.
    await expect(row.locator("[data-sub-agent-current]")).toContainText("pnpm test --coverage");
    // The chat is done and free to take a message; the sidebar still says something runs for it.
    const agents = page.getByRole("list", { name: "Background sub-agents tabs", exact: true });
    const marker = agents.locator("[data-background-agents]");
    await expect(marker).toHaveAttribute("data-background-agents", "1");
    await expect(marker).toHaveAttribute("data-row-state", "working");
    await expect(agents.getByRole("img", { name: "Agent status: Ready" })).toBeVisible();
    await row.getByRole("button", { name: "Open agent conversation", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Sub-agent conversation" });
    await expect(panel.getByRole("status").filter({ hasText: "Working" }).first()).toBeVisible();

    // It finishes on its own and reports back.
    await expect(row).toHaveAttribute("data-tool-status", "completed", { timeout: 10_000 });
    await expect(row).toHaveAttribute("aria-busy", "false");
    await expect(marker).toHaveCount(0);
    await expect(panel.getByRole("status").filter({ hasText: "Working" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await row.getByRole("button", { expanded: false }).click();
    await expect(row).toContainText("Coverage is 82%.");
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
