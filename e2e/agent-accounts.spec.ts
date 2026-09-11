import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("the first sign-in click survives a background focus refresh", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-account-focus-"));
  let holdNextRead = false;
  let heldRequest: string | undefined;
  let release: (() => void) | undefined;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (
        holdNextRead &&
        event.type === "agent.request" &&
        event.operation.kind === "account" &&
        event.operation.action.type === "read"
      ) {
        holdNextRead = false;
        heldRequest = event.requestId;
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (heldRequest && event.requestId === heldRequest) {
        heldRequest = undefined;
        release = () => {
          release = undefined;
          socket.send(raw);
        };
      } else socket.send(raw);
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "First-click sign-in", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    const prompt = page.getByRole("region", { name: "Codex account connection", exact: true });
    const signIn = prompt.getByRole("button", { name: "Sign in with ChatGPT", exact: true });
    await expect(signIn).toBeEnabled();
    holdNextRead = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => !!release).toBe(true);
    await expect(signIn).toBeEnabled();
    await signIn.click();
    release?.();
    await expect(prompt).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect(page.getByText(/Codex connected|fixture-account@example\.test/)).toHaveCount(0);
  } finally {
    release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [provider, label] of [
  ["codex", "Codex"],
  ["claude", "Claude Code"],
  ["opencode", "OpenCode"],
] as const) {
  test(`${label}: dismiss sign-in, connect and keep account identity out of chat`, async ({
    page,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "concors-account-ui-"));
    try {
      await signedIn(page);
      await page.goto("/");
      await seedProject(page, "Agent accounts", directory);
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
      if (provider !== "codex") {
        await page.getByRole("button", { name: "Agent and model", exact: true }).click();
        await page.getByRole("button", { name: "Back to providers", exact: true }).click();
        await page.getByRole("option", { name: `${label} Starts a new chat`, exact: true }).click();
        await page.getByRole("option", { name: `Fixture ${provider} model`, exact: true }).click();
      }
      const prompt = page.getByRole("region", { name: `${label} account connection` });
      const composer = page.getByRole("textbox", { name: `Message ${label}` });
      await expect(prompt).toBeVisible();
      await expect(composer).toBeEnabled();
      const promptBox = await prompt.boundingBox();
      const inputBox = await composer.boundingBox();
      if (!promptBox || !inputBox) throw new Error("Missing account prompt or composer");
      expect(promptBox.y).toBeLessThan(inputBox.y);
      await prompt.getByRole("button", { name: "Dismiss account connection" }).click();
      await expect(prompt).toHaveCount(0);
      await composer.fill("Continue without connecting an account");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByRole("log")).toContainText("Hello from");
      await page.reload();
      await expect(composer).toBeEnabled();
      await expect(prompt).toHaveCount(0);
      await page.getByRole("button", { name: "Connect account", exact: true }).click();
      await prompt
        .getByRole("button", {
          name:
            provider === "codex"
              ? "Sign in with ChatGPT"
              : provider === "opencode"
                ? "Add API key"
                : "Connect account",
          exact: true,
        })
        .click();
      await expect(prompt.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      await prompt.screenshot({ path: test.info().outputPath("account-prompt.png") });
      if (provider === "codex") {
        await expect(prompt).toContainText("TEST-CODE");
        await expect(prompt.getByRole("button", { name: "Open sign-in page" })).toBeVisible();
      } else {
        // Password inputs have no implicit textbox role.
        await prompt
          .getByLabel(provider === "claude" ? "Authorization code" : "Provider API key", {
            exact: true,
          })
          .fill("test-private-credential");
        await prompt.getByRole("button", { name: "Connect", exact: true }).click();
      }
      await expect(prompt).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: `${label} connected` })).toHaveCount(
        0,
      );
      await expect(page.getByText("fixture-account@example.test", { exact: false })).toHaveCount(0);
      await expect(page.getByRole("log")).not.toContainText("test-private-credential");
      await expect(page.getByRole("log")).not.toContainText("TEST-CODE");
      await expect(composer).toBeEnabled();
      await composer.fill("Continue after connecting an account");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByRole("log")).toContainText("Continue after connecting an account");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
