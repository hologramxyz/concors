import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { chooseProvider } from "./support/agents.ts";

test("typing a slash lists the provider's commands and choosing compact compacts", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-slash-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Slash commands", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();

    const commands = page.getByRole("listbox", { name: "Commands" });
    await composer.fill("/");
    await expect(commands.getByRole("option")).toHaveText([
      /\/compact.*Summarize earlier context/,
      /\/review.*Review a change/,
      /\/clear.*Start a new conversation here/,
    ]);
    // The best match sits next to the composer, and Up moves away from it.
    const top = (name: string) =>
      commands
        .getByRole("option", { name: new RegExp(`^/${name}`) })
        .boundingBox()
        .then((box) => box?.y ?? NaN);
    expect(await top("compact")).toBeGreaterThan(await top("review"));
    const details = page.locator("[data-slash-details]");
    await expect(details).toContainText("/compact");
    await composer.press("ArrowUp");
    await expect(commands.getByRole("option", { selected: true })).toContainText("/review");
    await expect(details).toContainText("<target>");
    const [menu, field] = await Promise.all([
      commands.boundingBox(),
      page.locator("form").filter({ has: composer }).boundingBox(),
    ]);
    expect(Math.abs((menu?.width ?? 0) - (field?.width ?? NaN))).toBeLessThan(2);
    await composer.press("Escape");
    await expect(commands).toHaveCount(0);
    await expect(composer).toHaveValue("/");

    // A command that needs an argument is completed into the draft rather than run.
    await composer.fill("/rev");
    await expect(commands.getByRole("option")).toHaveCount(1);
    await composer.press("Enter");
    await expect(composer).toHaveValue("/review ");
    await expect(commands).toHaveCount(0);

    await composer.fill("/co");
    await expect(commands.getByRole("option", { selected: true })).toContainText("/compact");
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    await expect(page.getByRole("log")).toContainText("Context compacted");
    await expect(page.getByRole("button", { name: "Interrupt agent", exact: true })).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("/clear starts over in the same pane and the old chat can be resumed", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-clear-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Clearing chats", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    await composer.fill("remember the old plan");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const log = page.getByRole("log");
    await expect(log).toContainText("Hello from");
    await expect(page.getByText(/^Worked for /)).toHaveCount(1);
    const pane = page.getByRole("region", { name: "Agent pane", exact: true });
    const paneId = await pane.getAttribute("data-pane-id");

    await composer.fill("/cl");
    const commands = page.getByRole("listbox", { name: "Commands" });
    await expect(commands.getByRole("option", { selected: true })).toContainText("/clear");
    await composer.press("Enter");
    await expect(log).not.toContainText("remember the old plan");
    await expect(pane).toHaveAttribute("data-pane-id", paneId ?? "");
    await expect(composer).toBeEnabled();
    await expect(composer).toHaveValue("");
    await expect(page.getByLabel("Agent and model", { exact: true })).toHaveText("Fixture model");

    await page.keyboard.press("Control+Shift+T");
    await page.keyboard.press("r");
    const dialog = page.getByRole("dialog", { name: "Resume a chat" });
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await expect(dialog.getByRole("option")).toContainText("remember the old plan");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("log")).toContainText("remember the old plan");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
