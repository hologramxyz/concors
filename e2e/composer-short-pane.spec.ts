import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("a short chat pane gives the composer its room, send button included", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-short-pane-"));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Short pane", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "New chat", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await expect(composer).toBeEnabled();
    // A long draft is what grows the text box past a short pane.
    await composer.fill(
      "It should cover all the user flows outlined inside the spec.\n".repeat(30),
    );

    await page.getByRole("button", { name: "Pane actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Split vertically", exact: true }).click();
    const handle = page.getByRole("separator", { name: "Resize split" });
    const box = await handle.boundingBox();
    if (!box) throw new Error("No split handle");
    // Drag the split up until the chat pane above it is about as short as it goes.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, 260, { steps: 10 });
    await page.mouse.up();

    // The account notice above the composer is there too, as on a fresh machine.
    await expect(page.getByText("Connect your ChatGPT account")).toBeVisible();
    const footer = page.locator("[data-chat-footer]");
    const composerBox = page.locator("[data-chat-footer] form");
    const toolbar = page.locator(".agent-composer-toolbar");
    const inside = async () => {
      const [outer, form, row, input] = await Promise.all([
        footer.boundingBox(),
        composerBox.boundingBox(),
        toolbar.boundingBox(),
        composer.boundingBox(),
      ]);
      if (!outer || !form || !row || !input) return "missing";
      if (form.y < outer.y - 0.5 || form.y + form.height > outer.y + outer.height + 0.5)
        return "composer clipped";
      if (row.y + row.height > form.y + form.height + 0.5) return "toolbar clipped";
      return input.height >= 60 ? "ok" : `text box ${input.height}px`;
    };
    await expect.poll(inside).toBe("ok");
    // The draft scrolls inside its box; the pane's footer has nothing hidden to scroll to.
    expect(await footer.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath("composer-short-pane.png") });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
