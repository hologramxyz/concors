import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("MCP servers are set once for the machine, keep their secrets there, and show in each chat", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-mcp-"));
  page.on("dialog", (dialog) => void dialog.accept());
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "MCP", directory);
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "MCP servers", exact: true })
      .click();
    const section = page.getByRole("region", { name: "MCP servers" });
    await expect(section).toContainText("No MCP servers yet");

    await section.getByRole("button", { name: "Add server" }).click();
    const editor = page.getByRole("dialog", { name: "Add an MCP server" });
    await editor.getByLabel("Name").fill("github");
    await editor.getByLabel("Command").fill("npx");
    await editor.getByLabel("Arguments").fill("-y\n@modelcontextprotocol/server-github");
    await editor.getByRole("button", { name: "Add a variable" }).click();
    await editor.getByLabel("Environment variables name 1").fill("GITHUB_TOKEN");
    await editor.getByLabel("Environment variables value 1").fill("ghp_secret_value");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(section).toContainText("npx -y @modelcontextprotocol/server-github");
    await expect(section).toContainText("Secrets saved on the machine: GITHUB_TOKEN");
    await expect(page.getByText("ghp_secret_value")).toHaveCount(0);

    // Editing shows the saved secret by name only, and keeps it when left blank.
    await section.getByRole("button", { name: "Edit github" }).click();
    const edit = page.getByRole("dialog", { name: "Edit github" });
    await expect(edit.getByLabel("Environment variables value 1")).toHaveAttribute(
      "placeholder",
      "Saved; leave blank to keep",
    );
    await expect(edit.getByLabel("Environment variables value 1")).toHaveValue("");
    await edit.getByLabel("Arguments").fill("stdio");
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await expect(section).toContainText("npx stdio");
    await expect(section).toContainText("Secrets saved on the machine: GITHUB_TOKEN");

    // Each chat shows the servers its agent loaded, from the pane's menu.
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await page.getByRole("button", { name: "Pane actions" }).last().click();
    await page.getByRole("menuitem", { name: "MCP servers…" }).click();
    const status = page.getByRole("list", { name: "MCP server status" });
    await expect(status.getByRole("listitem")).toHaveText([
      /Concors schedules \(built in\)\s*Connected/,
      /github\s*Needs sign-in/,
    ]);
    await page.keyboard.press("Escape");

    // Removing clears it from the machine.
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "MCP servers", exact: true })
      .click();
    await section.getByRole("button", { name: "Remove github" }).click();
    await expect(section).toContainText("No MCP servers yet");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
