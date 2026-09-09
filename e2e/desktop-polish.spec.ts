import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

test("visited tabs retain terminal screens and chat drafts without reconnecting or stealing shortcuts", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-desktop-polish-"));
  const errors: string[] = [];
  const attaches: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === "terminal.request" && message.operation.kind === "attach")
          attaches.push(message.operation.sessionId);
      } catch {
        /* Binary and handshake traffic are irrelevant. */
      }
    }),
  );
  try {
    await signedIn(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.getByLabel("Project name", { exact: true }).fill("Desktop polish");
    await page.getByLabel("Folder on this machine").fill(directory);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    const terminalPane = page.getByRole("region", { name: "Terminal pane", exact: true });
    await expect(
      terminalPane.getByLabel("Terminal output").filter({ visible: true }),
    ).toHaveAttribute("aria-busy", "false");
    await terminalPane.locator("textarea").focus();
    await page.keyboard.type("echo TAB_SCREEN_RETAINED");
    await page.keyboard.press("Enter");
    await expect(
      terminalPane.getByLabel("Terminal output").filter({ visible: true }),
    ).toContainText("TAB_SCREEN_RETAINED");
    const renderer = await terminalPane.locator(".xterm").filter({ visible: true }).elementHandle();
    if (!renderer) throw new Error("Terminal renderer did not mount");
    expect(attaches.length).toBeGreaterThan(0);
    const attachedBefore = attaches.length;
    await terminalPane.focus();
    await expect(terminalPane).toHaveCSS("outline-style", "none");
    await expect(terminalPane).toHaveCSS("box-shadow", "none");
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    const menu = page.getByRole("menu");
    const configure = menu.getByRole("menuitem", { name: "Configure terminal profile…" });
    expect(await configure.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: "test-results/desktop-tab-menu.png" });
    await menu.getByRole("menuitem", { name: "Agent", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Message Codex" });
    await expect(input).toBeEnabled();
    await expect(input).toBeFocused();
    await input.fill("Keep this draft while I check the terminal");
    await expect(
      page.getByText(/^(Preparing agent|Loading conversation|Reconnecting|Starting session)…$/),
    ).toHaveCount(0);
    expect(await renderer.evaluate((el) => el.isConnected)).toBe(true);
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Terminal", exact: true }).click();
      await expect(terminalPane.locator("textarea")).toBeFocused();
      expect(
        await renderer.evaluate((el) => el.isConnected && el.getClientRects().length > 0),
      ).toBe(true);
      await expect(
        terminalPane.getByLabel("Terminal output").filter({ visible: true }),
      ).toContainText("TAB_SCREEN_RETAINED");
      await page.getByRole("button", { name: "Agent", exact: true }).click();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("Keep this draft while I check the terminal");
    }
    expect(attaches.length).toBe(attachedBefore);
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(terminalPane.locator("textarea")).toBeFocused();
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("region", { name: "Terminal pane", exact: true })).toHaveCount(2);
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await expect(page.getByRole("region", { name: "Agent pane", exact: true })).toHaveCount(1);
    await input.fill("hold this stream");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByTestId("pane-agent-loading")).toBeVisible();
    await page.screenshot({ path: "test-results/desktop-agent-activity.png" });
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
