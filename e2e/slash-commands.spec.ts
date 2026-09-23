import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

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
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();

    const commands = page.getByRole("listbox", { name: "Commands" });
    await composer.fill("/");
    await expect(commands.getByRole("option")).toHaveText([
      /\/compact.*Summarize earlier context/,
      /\/review.*Review a change/,
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
