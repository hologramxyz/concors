import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";
import type { ProviderOperation } from "../packages/protocol/src/index.ts";
import { chooseProvider } from "./support/agents.ts";

test("a chat that hits its plan limit offers to switch the machine to another account", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-usage-limit-"));
  const daemon = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "usage limit fixture", version: "0.0.0" },
  });
  const provider = async (operation: ProviderOperation) => {
    const result = await daemon.requestProvider(operation, crypto.randomUUID());
    if (result.outcome.status !== "ok") throw new Error(result.outcome.message);
    return result.outcome;
  };
  // The fixture daemon cannot complete a real sign-in, so the page is told this one has.
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    const accountReads = new Set<string>();
    socket.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (
        event.type === "provider.request" &&
        event.operation.kind === "account" &&
        event.operation.id === "codex-limit-work"
      )
        accountReads.add(event.requestId);
      server.send(raw);
    });
    server.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (accountReads.delete(event.requestId) && event.outcome.status === "ok") {
        event.outcome.account = {
          ...event.outcome.account,
          status: "connected",
          label: "work@example.test",
        };
        socket.send(JSON.stringify(event));
      } else socket.send(raw);
    });
  });
  const unsubscribe = daemon.subscribeWorkspace(() => undefined);
  try {
    await daemon.connect();
    await expect.poll(() => daemon.workspace).not.toBeNull();
    const { revision } = await provider({ kind: "list" });
    await provider({
      kind: "save",
      expectedRevision: revision,
      config: {
        id: "codex-limit-work",
        label: "ChatGPT — Work",
        engine: "codex",
        enabled: true,
        command: ["codex"],
        subscription: { nickname: "Work" },
      },
    });

    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Usage limit", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await composer.fill("primitive-usage-limit");
    await composer.press("Enter");

    const prompt = page.getByRole("region", { name: "Usage limit", exact: true });
    await expect(prompt).toContainText("This ChatGPT account reached its usage limit");
    // The other account shows how much room it has before anyone picks it.
    await expect(prompt).toContainText("work@example.test");
    await expect(prompt).toContainText("Weekly · Fable 91% · Session 42%");
    await prompt.getByRole("button", { name: "Switch to work@example.test" }).click();

    // The machine now runs on that account, and the limit went with the old one.
    await expect(prompt).toHaveCount(0);
    const { providers } = await provider({ kind: "list" });
    expect(providers.find((p) => p.id === "codex-limit-work")?.active).toBe(true);
  } finally {
    // The fixture daemon is shared by the whole run; leave it on its default account.
    const { revision } = await provider({ kind: "list" }).catch(() => ({ revision: -1 }));
    if (revision >= 0)
      await provider({ kind: "remove", id: "codex-limit-work", expectedRevision: revision }).catch(
        () => undefined,
      );
    unsubscribe();
    daemon.disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
