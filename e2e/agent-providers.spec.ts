import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
for (const [provider, label] of [
  ["claude", "Claude Code"],
  ["opencode", "OpenCode"],
  ["pi", "Pi"],
] as const) {
  test(`select ${label}, stream a reply, and return to the original Codex chat`, async ({
    page,
  }) => {
    // Exercise provider discovery, streaming, reload and return to the original conversation.
    test.setTimeout(60_000);
    const directory = await mkdtemp(join(tmpdir(), "concors-provider-ui-"));
    try {
      await signedIn(page);
      await page.goto("/");
      await seedProject(page, "Provider picker", directory);
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
      const original = page.getByRole("textbox", { name: "Message Codex" });
      await expect(original).toBeEnabled();
      await original.fill("keep this Codex conversation");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByRole("log")).toContainText("Hello from");
      for (const name of ["Import session", "Fork session", "Rewind", "MCP servers"])
        await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
      await page.getByLabel("Agent and model", { exact: true }).click();
      await page.getByRole("button", { name: "Back to providers" }).click();
      await page.getByRole("option", { name: new RegExp(`^${label} Starts a new chat$`) }).click();
      await page.getByRole("option", { name: `Fixture ${provider} model`, exact: true }).click();
      const composer = page.getByRole("textbox", { name: `Message ${label}` });
      await expect(composer).toBeEnabled();
      for (const name of ["Import session", "Fork session", "Rewind", "MCP servers"])
        await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
      await expect(page.getByRole("log")).not.toContainText("keep this Codex conversation");
      await expect(
        page.getByRole("button", { name: "Thinking effort", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Permission mode", exact: true })).toHaveCount(
        0,
      );
      await composer.fill("new provider conversation");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByRole("log")).toContainText("Hello from");
      await page.reload();
      await expect(composer).toBeEnabled();
      await expect(page.getByRole("log")).toContainText("new provider conversation");
      await page
        .getByLabel("Project tabs", { exact: true })
        .getByRole("button", { name: "Agent", exact: true })
        .click();
      await expect(original).toBeEnabled();
      await expect(page.getByRole("log")).toContainText("keep this Codex conversation");
      await expect(page.getByRole("log")).not.toContainText("new provider conversation");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
