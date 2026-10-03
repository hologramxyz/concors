import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("damaged text attachments show a recoverable error without crashing the conversation", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-attachment-errors-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let damaged = true;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (damaged && message.type === "agent.result" && message.outcome.attachment) {
        // A truncated payload can pass the protocol's base64 alphabet check.
        message.outcome.attachment.data = "a";
      }
      socket.send(JSON.stringify(message));
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Attachment recovery", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Recoverable attachment preview ✓"),
    });
    await composer.fill("Read these notes");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    // The open chat has seen its finished turn, so it reads as Ready rather than Done.
    await expect(page.getByText(/^Worked for /)).toHaveCount(1);
    await expect(page.getByLabel("Agent status: Ready").first()).toBeVisible();
    const attachment = page.getByRole("button", { name: "notes.txt", exact: true });
    await attachment.click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "This attachment is damaged and could not be previewed.",
    );
    await page.getByRole("button", { name: "Close attachment" }).click();
    await expect(composer).toBeVisible();
    damaged = false;
    await attachment.click();
    await expect(page.getByRole("dialog")).toContainText("Recoverable attachment preview ✓");
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Close attachment" }).click();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
