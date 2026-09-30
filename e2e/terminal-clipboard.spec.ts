import { test, expect } from "@playwright/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { signedIn } from "./signed-in.ts";
import { managedHost } from "./support/managed-host";
import { openFolder } from "./support/projects.ts";

test.beforeEach(async ({ page, baseURL }) => {
  if (baseURL !== "http://localhost:15396") return;
  await page.route("http://localhost:15396/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/")) return route.fallback();
    const file = path.startsWith("/assets/") ? path.slice(1) : "index.html";
    const types: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".woff2": "font/woff2",
    };
    await route.fulfill({
      body: await readFile(resolve("apps/desktop/dist", file)),
      contentType: types[extname(file)] ?? "application/octet-stream",
    });
  });
});

test("terminal copies with Super, Ctrl+Shift and Insert shortcuts, pastes once, and preserves Ctrl+C", async ({
  page,
  context,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "clipboard-project-"));
  // The workspace suite also runs this spec, without the clipboard config's permissions.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  try {
    await signedIn(page);
    await managedHost(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Switch machine" }).click();
    await page.getByRole("menuitem", { name: /Second machine/ }).click();
    await openFolder(page, directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    const terminal = page.getByLabel("Terminal output").filter({ visible: true });
    await expect(terminal).toHaveAttribute("aria-busy", "false");
    const output = terminal.locator(".xterm-rows");
    await expect(output).toContainText("$");
    await terminal.click();
    await expect(terminal.locator(".xterm-helper-textarea")).toBeFocused();

    await page.keyboard.type("printf 'COPY_ME\\n'");
    await page.keyboard.press("Enter");
    const copied = output.getByText("COPY_ME", { exact: true });
    await expect(copied).toBeVisible();
    await copied.dblclick({ force: true });
    await page.keyboard.press("Meta+c");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("COPY_ME");
    await page.evaluate(() => navigator.clipboard.writeText("old clipboard"));
    await page.keyboard.press("Control+Shift+c");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("COPY_ME");

    await page.evaluate(() => navigator.clipboard.writeText("old clipboard"));
    await page.keyboard.press("Control+Insert");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("COPY_ME");

    await terminal.click();
    await page.evaluate(() => navigator.clipboard.writeText("printf 'PASTE_%s\\n' OK"));
    await page.keyboard.press("Meta+v");
    await expect(output).toContainText("printf 'PASTE_%s");
    await page.keyboard.press("Enter");
    await expect(output.getByText("PASTE_OK", { exact: true })).toBeVisible();

    await page.evaluate(() => navigator.clipboard.writeText("printf 'SHIFT_%s\\n' OK"));
    await page.keyboard.press("Control+Shift+v");
    await expect(output).toContainText("printf 'SHIFT_%s");
    await page.keyboard.press("Enter");
    await expect(output.getByText("SHIFT_OK", { exact: true })).toBeVisible();
    await expect(output.getByText("SHIFT_OK", { exact: true })).toHaveCount(1);

    await page.evaluate(() => navigator.clipboard.writeText("printf 'INSERT_%s\\n' OK"));
    await page.keyboard.press("Shift+Insert");
    await expect(output).toContainText("printf 'INSERT_%s");
    await page.keyboard.press("Enter");
    await expect(output.getByText("INSERT_OK", { exact: true })).toBeVisible();
    await expect(output.getByText("INSERT_OK", { exact: true })).toHaveCount(1);

    await page.keyboard.type("sleep 1; printf 'STILL_%s\\n' RUNNING");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Meta+c");
    await expect(output.getByText("STILL_RUNNING", { exact: true })).toBeVisible();
    await page.keyboard.type("sleep 30");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+c");
    await page.keyboard.type("printf 'INTERRUPT_%s\\n' OK");
    await page.keyboard.press("Enter");
    await expect(output.getByText("INTERRUPT_OK", { exact: true })).toBeVisible({ timeout: 3000 });

    await context.clearPermissions();
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          readText: async () => {
            throw new Error("Denied");
          },
        },
      }),
    );
    await page.keyboard.press("Meta+v");
    await expect(page.getByRole("alert")).toContainText("Could not paste from the clipboard");
    await page.keyboard.type("exit");
    await page.keyboard.press("Enter");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
