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
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
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
    await page.getByLabel("Agent and model", { exact: true }).click();
    await page.getByRole("combobox", { name: "Search agent and model" }).fill("Fixture");
    await page.getByRole("option", { name: "Fixture model", exact: true }).click();
    await expect(page.getByLabel("Agent and model", { exact: true })).toHaveText("Fixture model");
    await expect(page.getByLabel("Thinking effort")).toBeEnabled();
    await page.getByLabel("Thinking effort", { exact: true }).click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await expect(page.getByLabel("Thinking effort", { exact: true })).toHaveText("High");
    await expect(page.getByLabel("Permission mode")).toBeEnabled();
    await page.getByLabel("Permission mode", { exact: true }).click();
    await page.getByRole("option", { name: /Auto-review/ }).click();
    await expect(page.getByLabel("Permission mode")).toHaveAttribute("data-value", "auto-review");
    await expect(page.getByLabel("Permission mode", { exact: true })).toHaveText("Auto-review");
    await expect(
      page.getByRole("button", { name: "Attach files", exact: true }).locator("svg"),
    ).toHaveClass(/lucide-plus/);
    await expect(page.getByLabel("Plan mode", { exact: true })).toHaveText("");
    await expect(page.getByLabel("Speed", { exact: true })).toHaveText("");
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
    await page.getByLabel("Plan mode", { exact: true }).click();
    await expect(page.getByLabel("Plan mode", { exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByLabel("Speed", { exact: true })).toBeEnabled();
    await page.getByLabel("Speed", { exact: true }).click();
    await page.getByRole("option", { name: /Fast/ }).click();
    await expect(page.getByLabel("Speed", { exact: true })).toBeEnabled();
    await expect(page.getByText("Enter to send", { exact: false })).toHaveCount(0);
    await expect(page.getByTestId("pane-agent-loading")).toHaveCount(0);
    await page.getByLabel("Message Codex").fill("rich hold");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Attached: notes.txt");
    await expect(page.getByTestId("pane-agent-loading")).toBeVisible();
    await expect(page.getByRole("log").locator(".agent-shimmer").first()).toHaveCSS(
      "animation-name",
      "paseo-toolcall-shimmer",
    );
    const runningTools = page.locator('[data-tool-status="running"]');
    await expect(runningTools).toHaveCount(3);
    for (const tool of await runningTools.all()) {
      const label = tool.locator("button .agent-shimmer").first();
      await expect(label).toHaveCSS("animation-name", "paseo-toolcall-shimmer");
      await expect(label).toHaveCSS("-webkit-text-fill-color", "rgba(0, 0, 0, 0)");
      const position = await label.evaluate((el) => getComputedStyle(el).backgroundPosition);
      await expect
        .poll(() => label.evaluate((el) => getComputedStyle(el).backgroundPosition))
        .not.toBe(position);
    }
    await expect(page.locator('[data-tool-status="completed"] .agent-shimmer')).toHaveCount(0);
    const elapsed = page.getByLabel("Elapsed time", { exact: true });
    await expect(elapsed).toBeVisible();
    const initialElapsed = await elapsed.innerText();
    await expect(elapsed).not.toHaveText(initialElapsed);
    await expect(page.getByLabel("Message Codex")).toHaveCSS("font-size", "16px");
    await expect(page.getByLabel("Agent plan")).toContainText("Implement the change");
    await page.getByLabel("Sub-agent activity").getByText("Agent update", { exact: true }).click();
    await expect(page.getByLabel("Sub-agent activity")).toContainText("Inspecting tests");
    await expect(page.getByLabel("Context window")).toContainText("25%");
    await expect(page.getByLabel("Permission mode")).toBeEnabled();
    await page.getByRole("button", { name: "Thinking effort", exact: true }).click();
    await page.getByRole("option", { name: "Low", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Thinking effort", exact: true }),
    ).toHaveAttribute("data-value", "low");
    await expect(page.getByLabel("Thinking effort", { exact: true })).toHaveText("Low");
    await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
    await expect(page.getByRole("log").locator('[data-syntax="keyword"]').first()).toBeVisible();
    await page.getByRole("button", { name: "Copy code", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("const ready = true;");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByRole("log").locator(".agent-shimmer").first()).toHaveCSS(
      "animation-name",
      "none",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: /^Shell/ }).click();
    await expect(
      page
        .getByRole("button", { name: /^Shell/ })
        .locator(".agent-shimmer")
        .first(),
    ).toHaveCSS("animation-name", "paseo-toolcall-shimmer");
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
    await expect(page.getByLabel("Permission mode")).toHaveAttribute("data-value", "auto-review");
    await expect(page.getByLabel("Permission mode", { exact: true })).toHaveText("Auto-review");
    await expect(
      page.getByRole("button", { name: "Attach files", exact: true }).locator("svg"),
    ).toHaveClass(/lucide-plus/);
    await expect(page.getByLabel("Plan mode", { exact: true })).toHaveText("");
    await expect(page.getByLabel("Speed", { exact: true })).toHaveText("");
    await expect(page.getByRole("log")).toContainText("Attached: notes.txt");
    await expect(page.getByTestId("pane-agent-loading")).toHaveCount(0);
    await expect(page.getByRole("log").locator(".agent-shimmer")).toHaveCount(0);
    await page.getByLabel("Agent tasks").locator("summary").first().click();
    await expect(page.getByLabel("Agent tasks")).toContainText("Implement the change");
    await page.screenshot({ path: "test-results/agent-composer.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toBeVisible();
    const composer = await page.getByLabel("Message Codex").boundingBox();
    expect((composer?.x ?? 0) + (composer?.width ?? 0)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "test-results/agent-composer-mobile.png" });
    await page.getByRole("button", { name: "Pane actions", exact: true }).click();
    for (const name of ["Terminal", "Agent", "Codex", "Claude Code", "OpenCode"])
      await expect(page.getByRole("menuitemradio", { name, exact: true })).toBeEnabled();
    await page.getByRole("menuitemradio", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".concors-terminal .xterm")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
