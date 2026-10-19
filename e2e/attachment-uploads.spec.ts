import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

const DAEMON = "ws://127.0.0.1:7429/ws";

async function openChat(page: Page, name: string, directory: string) {
  await signedIn(page);
  await page.goto("/");
  await seedProject(page, name, directory);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
  await chooseProvider(page);
  const composer = page.getByRole("textbox", { name: "Message Codex" });
  await expect(composer).toBeEnabled();
  return composer;
}

test("attaches more than three files, and files over 1 MB, uploading each before it is sent", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-attachment-uploads-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The machine's confirmations are held back, so the uploads stay in progress until released.
  let hold = true;
  const held: string[] = [];
  let release: () => void = () => undefined;
  await page.routeWebSocket(DAEMON, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const text = String(raw);
      if (hold && JSON.parse(text).type === "upload.progress") held.push(text);
      else socket.send(text);
    });
    release = () => {
      hold = false;
      for (const text of held.splice(0)) socket.send(text);
    };
  });
  try {
    const composer = await openChat(page, "Attachment uploads", directory);
    await expect(page.getByRole("button", { name: "Attach files", exact: true })).toBeEnabled();
    const big = "0123456789abcdef\n".repeat(80_000);
    expect(big.length).toBeGreaterThan(1024 * 1024);
    await page.getByLabel("Upload files").setInputFiles([
      { name: "big.txt", mimeType: "text/plain", buffer: Buffer.from(big) },
      { name: "drop.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(3e6, 1) },
      ...[1, 2, 3, 4].map((n) => ({
        name: `note-${n}.md`,
        mimeType: "text/markdown",
        buffer: Buffer.from(`Note ${n}`),
      })),
    ]);
    const tray = page.locator("[data-composer-attachments]");
    await expect(tray.locator("[data-composer-attachment]")).toHaveCount(6);
    await expect(page.getByRole("progressbar", { name: "Uploading big.txt" })).toBeVisible();
    await expect(page.getByText(/three files|larger than/)).toHaveCount(0);

    // Sending waits for the uploads instead of refusing; until then the message stays put.
    await composer.fill("Read all of these");
    await composer.press("Enter");
    const waiting = page.getByRole("status").filter({ hasText: "Sending once" });
    await expect(waiting).toBeVisible();
    await expect(composer).toHaveValue("Read all of these");
    // The waiting message is locked: no typing into it, no more files.
    await expect(composer).not.toBeEditable();
    await composer.press("End");
    await composer.pressSequentially(" and more");
    await expect(composer).toHaveValue("Read all of these");
    await expect(page.getByRole("button", { name: "Attach files", exact: true })).toBeDisabled();
    // Not sending yet unlocks it, as Escape does.
    await page.getByRole("button", { name: "Don’t send yet" }).click();
    await expect(waiting).toHaveCount(0);
    await expect(composer).toBeEditable();
    await composer.press("Enter");
    await expect(waiting).toBeVisible();
    await composer.press("Escape");
    await expect(composer).toBeEditable();
    await composer.press("Enter");
    await expect(waiting).toBeVisible();

    // A file removed while it uploads is gone from the message, and its upload stops.
    await page.getByRole("button", { name: "Remove drop.bin", exact: true }).click();
    await expect(tray.locator("[data-composer-attachment]")).toHaveCount(5);
    release();

    const log = page.getByRole("log");
    const sent = log.locator("[data-message-attachments]").last();
    await expect(sent.getByRole("button")).toHaveCount(5);
    await expect(sent.getByRole("button", { name: "drop.bin" })).toHaveCount(0);
    await expect(composer).toHaveValue("");
    await expect(tray).toHaveCount(0);

    // The file over 1 MB opens from the machine.
    await sent.getByRole("button", { name: "big.txt", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("0123456789abcdef");
    await page.getByRole("button", { name: "Close attachment" }).click();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a machine without uploads keeps the old limits and says it needs an update", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-attachment-limits-"));
  await page.routeWebSocket(DAEMON, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      // As a machine that has not installed this Concors yet describes itself.
      if (message.type === "daemon.ready")
        message.capabilities = message.capabilities.filter(
          (c: string) => c !== "attachment-uploads",
        );
      socket.send(JSON.stringify(message));
    });
  });
  try {
    const composer = await openChat(page, "Attachment limits", directory);
    const upload = page.getByLabel("Upload files");
    await upload.setInputFiles(
      [1, 2, 3, 4].map((n) => ({
        name: `note-${n}.md`,
        mimeType: "text/markdown",
        buffer: Buffer.from(`Note ${n}`),
      })),
    );
    await expect(page.getByRole("alert")).toHaveText(
      "Attach up to three files per message. This machine needs a Concors update to attach more or larger files.",
    );
    await upload.setInputFiles({
      name: "big.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(2e6, 1),
    });
    await expect(page.getByRole("alert")).toHaveText(
      "big.bin is larger than 1 MB. This machine needs a Concors update to attach more or larger files.",
    );
    // Within the old limits it attaches inline, as before.
    await upload.setInputFiles({
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Small notes"),
    });
    await expect(page.getByRole("button", { name: "Remove notes.md", exact: true })).toBeVisible();
    await expect(page.locator("[data-upload]")).toHaveCount(0);
    await composer.fill("Read this");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const log = page.getByRole("log");
    await log.getByRole("button", { name: "notes.md", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Small notes");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
