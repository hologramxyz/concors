import { test, expect, signedIn } from "./signed-in.ts";

// The Providers settings page is hidden while only Codex, Claude Code and OpenCode are supported;
// restore this with its navigation entry.
test.skip("provider polling clears recovered read errors without concealing failed saves", async ({
  page,
}) => {
  let failLists = true;
  let refreshLabel = false;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (
        message.type === "provider.request" &&
        ((failLists && message.operation.kind === "list") || message.operation.kind === "save")
      ) {
        socket.send(
          JSON.stringify({
            type: "provider.result",
            requestId: message.requestId,
            outcome: {
              status: "error",
              message:
                message.operation.kind === "save"
                  ? "Provider settings could not be saved"
                  : "Provider list temporarily unavailable",
            },
          }),
        );
        return;
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (refreshLabel && message.type === "provider.result" && message.outcome.status === "ok") {
        for (const provider of message.outcome.providers)
          if (provider.id === "codex") provider.label = "Codex from refreshed list";
      }
      socket.send(JSON.stringify(message));
    });
  });
  await signedIn(page);
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await page.keyboard.press("Control+Shift+Comma");
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "Providers", exact: true })
    .click();
  const providers = page.getByRole("region", { name: "Agent providers", exact: true });
  await expect(providers.getByRole("alert")).toContainText("Provider list temporarily unavailable");
  failLists = false;
  await expect(providers.getByRole("button", { name: "Configure Codex", exact: true })).toBeVisible(
    {
      timeout: 10_000,
    },
  );
  await expect(providers.getByRole("alert")).toHaveCount(0);

  await providers.getByRole("button", { name: "Configure Codex", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Configure Codex", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("Codex pending change");
  await dialog.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Provider settings could not be saved");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Codex pending change");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  refreshLabel = true;
  await expect(
    providers.getByRole("button", { name: "Configure Codex from refreshed list", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(providers.getByRole("alert")).toContainText("Provider settings could not be saved");
});
