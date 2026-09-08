import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { signedIn } from "./signed-in";
test("agent controls, uploads, tool details, plans, sub-agents, dictation and queued prompts work together", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-composer-"));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await signedIn(page);
    await page.addInitScript(() => {
      class Recognition {
        continuous = false;
        interimResults = false;
        lang = "en";
        onresult: ((event: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          setTimeout(
            () =>
              this.onresult?.({
                resultIndex: 0,
                results: [{ isFinal: true, 0: { transcript: "dictated message" } }],
              }),
            10,
          );
        }
        stop() {
          this.onend?.();
        }
        abort() {
          this.onend?.();
        }
      }
      Object.defineProperty(window, "SpeechRecognition", { value: Recognition });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.getByLabel("Project name", { exact: true }).fill("Composer acceptance");
    await page.getByLabel("Folder on this machine").fill(directory);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await page.getByLabel("Message Codex").waitFor();
    await expect(page.getByLabel("Agent and model")).toBeEnabled();
    await page.getByLabel("Agent and model").selectOption("fixture");
    await expect(page.getByLabel("Thinking effort")).toBeEnabled();
    await page.getByLabel("Thinking effort").selectOption("high");
    await expect(page.getByLabel("Permission mode")).toBeEnabled();
    await page.getByLabel("Permission mode").selectOption("auto-review");
    await expect(page.getByLabel("Permission mode")).toHaveValue("auto-review");
    await expect(page.getByLabel("Permission mode")).toBeEnabled();
    await page.getByLabel("Upload files").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A project note"),
    });
    await expect(page.getByRole("button", { name: "Remove notes.txt", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Start dictation", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("dictated message");
    await page.getByRole("button", { name: "Stop dictation", exact: true }).click();
    await page.getByLabel("Message Codex").fill("rich hold");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Attached: notes.txt");
    await expect(page.getByLabel("Agent plan")).toContainText("Implement the change");
    await expect(page.getByLabel("Sub-agent activity")).toContainText("Inspecting tests");
    await expect(page.getByLabel("Context window")).toContainText("25%");
    await expect(page.getByLabel("Permission mode")).toBeDisabled();
    await page.getByRole("button", { name: /^Shell/ }).click();
    await expect(page.getByLabel("Tool call").filter({ hasText: "fixture output" })).toBeVisible();
    await page.getByRole("button", { name: /^Edit/ }).click();
    await expect(page.getByText("+new line", { exact: true })).toBeVisible();
    await page.getByLabel("Message Codex").fill("queued follow-up");
    await page.getByRole("button", { name: "Queue message", exact: true }).click();
    await expect(page.getByText("Queued", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Interrupt agent", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("queued follow-up");
    await expect(page.getByRole("button", { name: "Queue message", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("Permission mode")).toHaveValue("auto-review");
    await expect(page.getByRole("log")).toContainText("Attached: notes.txt");
    await page.screenshot({ path: "test-results/agent-composer.png" });
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
