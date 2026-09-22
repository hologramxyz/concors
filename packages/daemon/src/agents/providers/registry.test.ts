import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { providerPresets, ProviderRequestSchema } from "@concors/protocol";
import { ProviderRegistry } from "./registry.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((p) => rm(p, { recursive: true, force: true })));
  directories.length = 0;
  vi.unstubAllEnvs();
});
it("includes the audited six native providers and 38 opt-in ACP presets", () => {
  expect(providerPresets).toHaveLength(44);
  expect(new Set(providerPresets.map((p) => p.id)).size).toBe(44);
  expect(providerPresets.filter((p) => p.id.startsWith("acp-")).every((p) => !p.enabled)).toBe(
    true,
  );
  expect(providerPresets.find((p) => p.id === "omp")?.enabled).toBe(false);
});
it("persists private credentials without returning them and rejects stale edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-provider-settings-"));
  directories.push(root);
  const registry = new ProviderRegistry(root);
  const config = {
    id: "custom-example",
    label: "Example",
    engine: "acp" as const,
    enabled: true,
    command: [process.execPath, "--version"],
    env: { EXAMPLE_KEY: "private-test-value" },
  };
  const request = ProviderRequestSchema.parse({
    type: "provider.request",
    requestId: randomUUID(),
    operation: { kind: "save", config, expectedRevision: 0 },
  });
  const result = registry.request(request);
  expect(result.outcome.status).toBe("ok");
  expect(JSON.stringify(result)).not.toContain("private-test-value");
  expect(registry.request(request)).toEqual(result);
  expect(new ProviderRegistry(root).config(config.id).env?.["EXAMPLE_KEY"]).toBe(
    "private-test-value",
  );
  if (process.platform !== "win32")
    expect((await stat(join(root, "config.json"))).mode & 0o077).toBe(0);
  const stale = registry.request({ ...request, requestId: randomUUID() });
  expect(stale.outcome.status).toBe("error");
  const replace = registry.request({
    ...request,
    requestId: randomUUID(),
    operation: { kind: "save", config: { ...config, env: {} }, expectedRevision: 1 },
  });
  expect(replace.outcome.status).toBe("ok");
  expect(registry.config(config.id).env?.["EXAMPLE_KEY"]).toBe("private-test-value");
  registry.request({
    ...request,
    requestId: randomUUID(),
    operation: {
      kind: "save",
      config: { ...config, env: {} },
      removeEnv: ["EXAMPLE_KEY"],
      expectedRevision: 2,
    },
  });
  expect(await readFile(join(root, "config.json"), "utf8")).not.toContain("private-test-value");
});
it("keeps subscriptions in creation order when an older account is renamed", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-provider-order-"));
  directories.push(root);
  const registry = new ProviderRegistry(root);
  const save = (id: string, nickname: string, revision: number) =>
    registry.request({
      type: "provider.request",
      requestId: randomUUID(),
      operation: {
        kind: "save",
        expectedRevision: revision,
        config: {
          id,
          label: `Claude — ${nickname}`,
          engine: "claude",
          enabled: true,
          command: ["claude"],
          subscription: { nickname },
        },
      },
    });
  expect(save("claude-old", "Old", 0).outcome.status).toBe("ok");
  expect(save("claude-new", "New", 1).outcome.status).toBe("ok");
  expect(save("claude-old", "Renamed", 2).outcome.status).toBe("ok");
  expect(
    registry
      .statuses()
      .filter((provider) => provider.subscription)
      .map((provider) => provider.id),
  ).toEqual(["claude-old", "claude-new"]);
});
it("does not execute npx or download a preset while checking installed providers", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-provider-discovery-"));
  directories.push(root);
  const registry = new ProviderRegistry(root);
  const preset = registry.config("acp-gemini");
  expect(registry.installed(preset)).toBe(false);
  expect(() => registry.launcher({ ...preset, enabled: true })).toThrow("not installed");
  expect(registry.statuses().find((p) => p.id === preset.id)).toMatchObject({
    installed: false,
    canInstall: true,
    installStatus: "idle",
  });
});
it("preserves argv boundaries and credentials for a configured executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-provider-argv-"));
  directories.push(root);
  const script = join(root, "argument fixture.mjs");
  await writeFile(
    script,
    "console.log(JSON.stringify({args:process.argv.slice(2),key:process.env.EXAMPLE_KEY}));",
  );
  const registry = new ProviderRegistry(root);
  const launch = registry.launcher({
    id: "example",
    label: "Example",
    engine: "acp",
    enabled: true,
    command: [process.execPath, script],
    env: { EXAMPLE_KEY: "fixture" },
  });
  const child = launch(
    "example",
    ["with spaces", "$(echo should-not-run)", '{"key":"value"}'],
    root,
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  await new Promise<void>((done, reject) => {
    child.once("close", () => done());
    child.once("error", reject);
  });
  expect(JSON.parse(output)).toEqual({
    args: ["with spaces", "$(echo should-not-run)", '{"key":"value"}'],
    key: "fixture",
  });
});

it("keeps MCP headers and process environment private while preserving existing overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-mcp-settings-"));
  directories.push(root);
  const registry = new ProviderRegistry(root);
  const config = {
    ...registry.config("claude"),
    params: {
      mcpServers: [
        {
          name: "docs",
          type: "http" as const,
          url: "https://example.test/mcp",
          headers: { Authorization: "Bearer fixture-secret" },
        },
      ],
    },
  };
  const result = registry.request({
    type: "provider.request",
    requestId: randomUUID(),
    operation: { kind: "save", expectedRevision: 0, config },
  });
  expect(result.outcome.status).toBe("ok");
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
  expect(registry.statuses().find((p) => p.id === "claude")?.mcpServerNames).toEqual(["docs"]);
  const edited = { ...registry.config("claude"), label: "Personal Claude", params: {} };
  registry.request({
    type: "provider.request",
    requestId: randomUUID(),
    operation: { kind: "save", expectedRevision: 1, config: edited },
  });
  expect(registry.config("claude").params?.mcpServers).toHaveLength(1);
  expect(JSON.stringify(registry.terminalEnvironment())).not.toContain("fixture-secret");
});

it("keeps private OpenCode transport settings authoritative without discarding account variables", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-provider-transport-"));
  directories.push(root);
  const script = join(root, "transport.mjs");
  await writeFile(
    script,
    "console.log(JSON.stringify([process.env.OPENCODE_SERVER_USERNAME,process.env.OPENCODE_SERVER_PASSWORD,process.env.OPENCODE_CONFIG_CONTENT,process.env.EXAMPLE_ACCOUNT]));",
  );
  const registry = new ProviderRegistry(root);
  const launch = registry.launcher({
    id: "opencode-profile",
    label: "OpenCode profile",
    engine: "opencode",
    enabled: true,
    command: [process.execPath, script],
    env: {
      OPENCODE_SERVER_USERNAME: "profile-user",
      OPENCODE_SERVER_PASSWORD: "profile-password",
      OPENCODE_CONFIG_CONTENT: "profile-config",
      EXAMPLE_ACCOUNT: "own-account",
    },
  });
  const child = launch("opencode", [], root, {
    OPENCODE_SERVER_USERNAME: "concors",
    OPENCODE_SERVER_PASSWORD: "private-transport",
    OPENCODE_CONFIG_CONTENT: "adapter-config",
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  await new Promise<void>((resolve, reject) => {
    child.once("close", () => resolve());
    child.once("error", reject);
  });
  expect(JSON.parse(output)).toEqual([
    "concors",
    "private-transport",
    "adapter-config",
    "own-account",
  ]);
});
it("provisions an isolated credential home for a subscription and removes it on delete", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-subscriptions-"));
  directories.push(root);
  const registry = new ProviderRegistry(join(root, "providers"));
  const config = {
    id: "claude-work",
    label: "Claude — Work",
    engine: "claude" as const,
    enabled: true,
    command: ["claude"],
    subscription: { nickname: "Work" },
  };
  const save = registry.request(
    ProviderRequestSchema.parse({
      type: "provider.request",
      requestId: randomUUID(),
      operation: { kind: "save", config, expectedRevision: 0 },
    }),
  );
  if (save.outcome.status !== "ok") throw new Error(save.outcome.message);
  const home = join(root, "accounts", "claude", "claude-work");
  expect(registry.config("claude-work").env?.["CLAUDE_CONFIG_DIR"]).toBe(home);
  expect((await stat(home)).isDirectory()).toBe(true);
  if (process.platform !== "win32") expect((await stat(home)).mode & 0o077).toBe(0);
  const status = save.outcome.providers.find((p) => p.id === "claude-work");
  expect(status?.subscription?.nickname).toBe("Work");
  expect(status?.envKeys).toContain("CLAUDE_CONFIG_DIR");
  // The credential home's location is an env value, and values never leave the machine.
  expect(JSON.stringify(save)).not.toContain(home);
  await writeFile(join(home, "credentials.json"), "fixture-oauth-token");
  const removal = registry.request(
    ProviderRequestSchema.parse({
      type: "provider.request",
      requestId: randomUUID(),
      operation: { kind: "remove", id: "claude-work", expectedRevision: 1 },
    }),
  );
  expect(removal.outcome.status).toBe("ok");
  await expect(stat(home)).rejects.toThrow();
});
it("gives Codex subscriptions their own CODEX_HOME and rejects unsupported engines", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-subscriptions-codex-"));
  directories.push(root);
  const registry = new ProviderRegistry(join(root, "providers"));
  const save = (config: object, expectedRevision: number) =>
    registry.request(
      ProviderRequestSchema.parse({
        type: "provider.request",
        requestId: randomUUID(),
        operation: { kind: "save", config, expectedRevision },
      }),
    );
  const base = { enabled: true, subscription: { nickname: "Personal" } };
  const codex = save(
    {
      ...base,
      id: "codex-personal",
      label: "Codex — Personal",
      engine: "codex",
      command: ["codex"],
    },
    0,
  );
  expect(codex.outcome.status).toBe("ok");
  expect(registry.config("codex-personal").env?.["CODEX_HOME"]).toBe(
    join(root, "accounts", "codex", "codex-personal"),
  );
  const rejected = save(
    { ...base, id: "pi-personal", label: "Pi — Personal", engine: "pi", command: ["pi"] },
    1,
  );
  expect(rejected.outcome.status).toBe("error");
  const builtin = save(
    { ...base, id: "claude", label: "Claude Code", engine: "claude", command: ["claude"] },
    1,
  );
  expect(builtin.outcome.status).toBe("error");
  expect(registry.revision).toBe(1);
});
it("keeps Codex conversation state stable and recovers threads from legacy account homes", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-subscriptions-codex-state-"));
  directories.push(root);
  const shared = join(root, "shared-codex-state");
  vi.stubEnv("CODEX_SQLITE_HOME", shared);
  const registry = new ProviderRegistry(join(root, "providers"));
  const saved = registry.request(
    ProviderRequestSchema.parse({
      type: "provider.request",
      requestId: randomUUID(),
      operation: {
        kind: "save",
        expectedRevision: 0,
        config: {
          id: "codex-work",
          label: "Codex — Work",
          engine: "codex",
          enabled: true,
          command: ["codex"],
          subscription: { nickname: "Work" },
        },
      },
    }),
  );
  expect(saved.outcome.status).toBe("ok");
  const legacyHome = join(root, "accounts", "codex", "codex-work");
  const threadId = randomUUID();
  const database = new DatabaseSync(join(legacyHome, "state_5.sqlite"));
  database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY)");
  database.prepare("INSERT INTO threads (id) VALUES (?)").run(threadId);
  database.close();

  expect(registry.conversationEnvironment("codex")).toEqual({ CODEX_SQLITE_HOME: shared });
  expect(registry.conversationEnvironment("codex", randomUUID())).toEqual({
    CODEX_SQLITE_HOME: shared,
  });
  expect(registry.conversationEnvironment("codex", threadId)).toEqual({
    CODEX_SQLITE_HOME: legacyHome,
  });

  await writeFile(join(legacyHome, "auth.json"), "fixture-secret");
  const removed = registry.request(
    ProviderRequestSchema.parse({
      type: "provider.request",
      requestId: randomUUID(),
      operation: { kind: "remove", id: "codex-work", expectedRevision: 1 },
    }),
  );
  expect(removed.outcome.status).toBe("ok");
  await expect(stat(join(legacyHome, "auth.json"))).rejects.toThrow();
  expect((await stat(join(legacyHome, "state_5.sqlite"))).isFile()).toBe(true);
  expect(registry.conversationEnvironment("codex", threadId)).toEqual({
    CODEX_SQLITE_HOME: legacyHome,
  });
});
it("resolves a subscription's binaries from its engine's base installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-subscription-bin-"));
  directories.push(root);
  const bin = join(root, "providers", "claude", "node_modules", ".bin");
  await mkdir(bin, { recursive: true });
  const name = "claude" + (process.platform === "win32" ? ".cmd" : "");
  await writeFile(join(bin, name), "", { mode: 0o755 });
  vi.stubEnv("PATH", root);
  try {
    const registry = new ProviderRegistry(join(root, "providers"));
    const result = registry.request(
      ProviderRequestSchema.parse({
        type: "provider.request",
        requestId: randomUUID(),
        operation: {
          kind: "save",
          config: {
            id: "claude-work",
            label: "Claude — Work",
            engine: "claude",
            enabled: true,
            command: ["claude"],
            subscription: { nickname: "Work" },
          },
          expectedRevision: 0,
        },
      }),
    );
    if (result.outcome.status !== "ok") throw new Error(result.outcome.message);
    expect(result.outcome.providers.find((p) => p.id === "claude-work")?.installed).toBe(true);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("activates one subscription machine-wide and falls back to the default on removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-subscription-active-"));
  directories.push(root);
  const registry = new ProviderRegistry(join(root, "providers"));
  const request = (operation: object) =>
    registry.request(
      ProviderRequestSchema.parse({
        type: "provider.request",
        requestId: randomUUID(),
        operation,
      }),
    );
  const flags = (result: ReturnType<typeof registry.request>) =>
    result.outcome.status === "ok"
      ? Object.fromEntries(
          result.outcome.providers
            .filter((p) => ["claude", "claude-work"].includes(p.id))
            .map((p) => [p.id, p.active]),
        )
      : result.outcome.message;
  const save = request({
    kind: "save",
    config: {
      id: "claude-work",
      label: "Claude — Work",
      engine: "claude",
      enabled: true,
      command: ["claude"],
      subscription: { nickname: "Work" },
    },
    expectedRevision: 0,
  });
  // The default account is active until a subscription takes over, and conversations of the
  // engine's regular configurations run under the active subscription's credential home.
  expect(flags(save)).toEqual({ claude: true, "claude-work": false });
  expect(registry.credentialDir(registry.config("claude"))).toBeUndefined();
  const rejected = request({
    kind: "activate",
    engine: "claude",
    id: "codex",
    expectedRevision: 1,
  });
  expect(rejected.outcome.status).toBe("error");
  const activated = request({
    kind: "activate",
    engine: "claude",
    id: "claude-work",
    expectedRevision: 1,
  });
  expect(flags(activated)).toEqual({ claude: false, "claude-work": true });
  const home = join(root, "accounts", "claude", "claude-work");
  expect(registry.credentialDir(registry.config("claude"))).toBe(home);
  // The subscription itself and explicitly configured credential homes are never redirected.
  expect(registry.credentialDir(registry.config("claude-work"))).toBe(home);
  expect(
    registry.credentialDir({
      ...registry.config("claude"),
      env: { CLAUDE_CONFIG_DIR: "/custom/home" },
    }),
  ).toBe("/custom/home");
  // The machine remembers its choice across restarts.
  const reloaded = new ProviderRegistry(join(root, "providers"));
  expect(reloaded.credentialDir(reloaded.config("claude"))).toBe(home);
  const removal = request({ kind: "remove", id: "claude-work", expectedRevision: 2 });
  if (removal.outcome.status !== "ok") throw new Error(removal.outcome.message);
  expect(removal.outcome.providers.find((p) => p.id === "claude")?.active).toBe(true);
  expect(registry.credentialDir(registry.config("claude"))).toBeUndefined();
});
