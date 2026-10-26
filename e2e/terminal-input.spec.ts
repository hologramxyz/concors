import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("an input method's keystroke never sends what was already typed again", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-terminal-input-"));
  const sent: string[] = [];
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (event.type === "terminal.input") sent.push(event.data);
      server.send(raw);
    });
    server.onMessage((raw) => socket.send(raw));
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Typing", directory);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toBeVisible();
    const textarea = page.locator(".xterm-helper-textarea").first();
    await textarea.focus();
    await page.keyboard.type("echo teh sidebar", { delay: 20 });
    await expect.poll(() => sent.join("")).toBe("echo teh sidebar");
    // The keys went to the terminal; none are left behind for an input method to find.
    expect((await textarea.inputValue()).trim()).toBe("");
    // An input method (macOS autocorrect, a Chinese or Japanese IME) presses keyCode 229 and
    // rewrites the field's text in place.
    await textarea.evaluate((area: HTMLTextAreaElement) => {
      area.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 229, bubbles: true } as KeyboardEventInit),
      );
      area.value = area.value.replace("teh", "the");
    });
    await page.keyboard.type("!", { delay: 20 });
    await expect.poll(() => sent.join("")).toBe("echo teh sidebar!");
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).not.toContainText(
      "sidebarecho",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
