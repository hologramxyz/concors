import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("effective models stay selected and warm provider menus reopen without loading", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-model-picker-"));
  const requests: string[] = [];
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "agent.request" && message.operation?.kind === "provider-catalog")
        requests.push(message.operation.provider ?? "providers");
      server.send(raw);
    });
    server.onMessage((raw) => {
      // Native catalog metadata, on top of the deterministic no-network test provider.
      const message = JSON.parse(String(raw), (key, value) => {
        if (key !== "models" || !Array.isArray(value)) return value;
        return value.map((model) =>
          model.id === "fixture"
            ? { ...model, label: "GPT-6 Astra" }
            : model.id === "fixture-claude"
              ? { ...model, label: "Opus", resolvedModel: "claude-opus-5" }
              : model,
        );
      });
      socket.send(JSON.stringify(message));
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Model menus", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    const picker = page.getByRole("button", { name: "Agent and model", exact: true });
    await expect(picker).toHaveText("GPT-6 Astra");
    await picker.click();
    await expect(page.getByRole("option", { name: "GPT-6 Astra", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("Machine default", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to providers", exact: true }).click();
    await page.getByRole("option", { name: "Claude Code Starts a new chat", exact: true }).click();
    await expect(page.getByRole("option", { name: "Opus 5", exact: true })).toBeVisible();
    const warmed = requests.length;
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("Escape");
      await picker.click();
      await page.getByRole("button", { name: "Back to providers", exact: true }).click();
      await page
        .getByRole("option", { name: "Claude Code Starts a new chat", exact: true })
        .click();
      await expect(page.getByRole("option", { name: "Opus 5", exact: true })).toBeVisible();
      await expect(page.getByText("Loading providers…", { exact: true })).toHaveCount(0);
    }
    expect(requests.filter((provider) => provider === "claude")).toHaveLength(1);
    // Other providers may still be warming, but menu navigation cannot repeat discovery.
    expect(requests.length - warmed).toBeLessThanOrEqual(3);
    await page.getByRole("option", { name: "Opus 5", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message Claude Code" })).toBeEnabled();
    await expect(picker).toHaveText("Opus 5");
    await picker.click();
    await expect(page.getByRole("option", { name: "Opus 5", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.screenshot({ path: test.info().outputPath("resolved-model-picker.png") });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
