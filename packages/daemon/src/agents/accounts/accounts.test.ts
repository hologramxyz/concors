import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentInfo } from "@concors/protocol";
import { AgentAccountSchema } from "@concors/protocol";
import { CodexAccount } from "./codex.ts";
import { ClaudeAccount } from "./claude.ts";
import { OpenCodeAccount } from "./opencode.ts";
import { AgentAccounts, createAccountBackend } from "./manager.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderConfig } from "@concors/protocol";
import type { AccountBackend } from "./backend.ts";
import type { ConversationProvider } from "../providers/contract.ts";
import type { launch } from "../providers/launch.ts";

const info = { id: "agent", provider: "codex", directory: "/project" } as AgentInfo;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function backend() {
  let done: (error?: Error) => void = () => undefined;
  const value = {
    read: vi.fn(async () => ({
      connected: false,
      methods: [{ id: "test", label: "Connect", kind: "browser" as const }],
    })),
    start: vi.fn(async (_id: string, complete: (error?: Error) => void) => {
      done = complete;
      return { url: "https://auth.openai.com/codex/device", code: "secret-code" };
    }),
    complete: vi.fn(async (_code: string) => {
      done();
    }),
    close: vi.fn(async (): Promise<void> => undefined),
  } satisfies AccountBackend;
  return { ...value, finish: (error?: Error) => done(error) };
}
function provider(respond: (method: string, params?: unknown) => Promise<unknown>) {
  let notify: (method: string, params: unknown) => void = () => undefined;
  const value: ConversationProvider = {
    initialize: vi.fn(async () => undefined),
    request: vi.fn(respond),
    close: vi.fn(async (): Promise<void> => undefined),
    onFailure: () => undefined,
    onNotification: (fn) => {
      notify = fn;
      return () => undefined;
    },
  };
  return { value, notify: (method: string, params: unknown) => notify(method, params) };
}

it("uses the daemon registry's launcher for custom Claude account settings", async () => {
  const registry = new ProviderRegistry();
  const config: ProviderConfig = {
    id: "team-claude",
    label: "Team Claude",
    engine: "claude",
    command: ["/private/claude"],
    enabled: true,
    env: { CLAUDE_CONFIG_DIR: "/private/team-config" },
  };
  vi.spyOn(registry, "config").mockReturnValue(config);
  const process = child();
  const spawn = vi.fn<typeof launch>(() => process);
  const launcher = vi.spyOn(registry, "launcher").mockReturnValue(spawn);
  const account = createAccountBackend({ ...info, provider: config.id }, registry);
  const read = account.read();
  process.stdout.emit("data", Buffer.from('{"loggedIn":true}'));
  process.emit("close", 0);
  expect((await read).connected).toBe(true);
  expect(launcher).toHaveBeenCalledWith(config);
  expect(spawn).toHaveBeenCalledWith("claude", ["auth", "status", "--json"], info.directory);
  await account.close();
});

it.each(["codex", "opencode"] as const)(
  "routes custom %s account profiles by engine",
  async (engine) => {
    const registry = new ProviderRegistry();
    vi.spyOn(registry, "config").mockReturnValue({
      id: "custom",
      label: "Custom",
      engine,
      command: ["custom"],
      enabled: true,
    });
    const p = provider(async () => ({}));
    const factory = vi.fn(() => p.value);
    const account = createAccountBackend({ ...info, provider: "custom" }, registry, factory);
    expect(account).toBeInstanceOf(engine === "codex" ? CodexAccount : OpenCodeAccount);
    expect(factory).toHaveBeenCalledWith(info.directory, expect.any(Function), "custom");
    await account.close();
  },
);

it.each(["pi", "omp", "acp"] as const)(
  "does not send OpenCode account RPCs to %s providers",
  (engine) => {
    const registry = new ProviderRegistry();
    vi.spyOn(registry, "config").mockReturnValue({
      id: "custom",
      label: "Custom",
      engine,
      command: ["custom"],
      enabled: true,
    });
    const factory = vi.fn();
    expect(() => createAccountBackend({ ...info, provider: "custom" }, registry, factory)).toThrow(
      "not supported",
    );
    expect(factory).not.toHaveBeenCalled();
  },
);
describe("socket-scoped provider accounts", () => {
  it("keeps challenges private, rejects another client's code, and discards them on disconnect", async () => {
    const backends: ReturnType<typeof backend>[] = [];
    const connected = vi.fn();
    const accounts = new AgentAccounts(() => {
      const b = backend();
      backends.push(b);
      return b;
    }, connected);
    try {
      const flow = await accounts.request("one", info, { type: "start", methodId: "test" });
      expect(flow.challenge?.code).toBe("secret-code");
      expect((await accounts.request("two", info, { type: "read" })).challenge).toBeUndefined();
      await expect(
        accounts.request("two", info, {
          type: "complete",
          flowId: flow.challenge!.flowId,
          value: "private",
        }),
      ).rejects.toThrow("expired");
      await accounts.request("one", info, {
        type: "complete",
        flowId: flow.challenge!.flowId,
        value: "private",
      });
      expect(connected).toHaveBeenCalledWith(info);
      expect(backends[0]!.complete).toHaveBeenCalledWith("private");
      await accounts.detach("one");
      expect(backends[0]!.close).toHaveBeenCalled();
      expect(backends[1]!.close).not.toHaveBeenCalled();
    } finally {
      await accounts.close();
    }
  });
  it("cancels, expires and ignores late completions", async () => {
    vi.useFakeTimers();
    const b = backend();
    const connected = vi.fn();
    const accounts = new AgentAccounts(() => b, connected);
    const first = await accounts.request("one", info, { type: "start", methodId: "test" });
    await accounts.request("one", info, { type: "cancel", flowId: first.challenge!.flowId });
    b.finish();
    expect(connected).not.toHaveBeenCalled();
    const second = await accounts.request("one", info, { type: "start", methodId: "test" });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await expect(
      accounts.request("one", info, {
        type: "complete",
        flowId: second.challenge!.flowId,
        value: "code",
      }),
    ).rejects.toThrow("expired");
    expect(b.close).toHaveBeenCalledTimes(2);
    await accounts.close();
  });
  it("does not return provider errors that contain secrets", async () => {
    const b = backend();
    b.complete.mockRejectedValue(new Error("provider echoed sensitive-key"));
    const accounts = new AgentAccounts(() => b);
    const flow = await accounts.request("one", info, { type: "start", methodId: "test" });
    await expect(
      accounts.request("one", info, {
        type: "complete",
        flowId: flow.challenge!.flowId,
        value: "sensitive-key",
      }),
    ).rejects.not.toThrow("sensitive-key");
    expect(b.close).toHaveBeenCalled();
    await accounts.close();
  });
  it("rejects unsafe sign-in links", () => {
    for (const url of [
      "javascript:alert(1)",
      "http://example.com",
      "https://user:secret@example.com",
    ]) {
      expect(
        AgentAccountSchema.safeParse({
          status: "pending",
          methods: [],
          challenge: { flowId: crypto.randomUUID(), expiresAt: new Date().toISOString(), url },
        }).success,
      ).toBe(false);
    }
  });
});
it("uses Codex device auth and only accepts the matching login completion", async () => {
  const p = provider(async (method) => {
    if (method === "account/read") return { account: null, requiresOpenaiAuth: true };
    if (method === "account/login/start")
      return {
        loginId: "login",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD",
      };
    return {};
  });
  const account = new CodexAccount(p.value);
  const done = vi.fn();
  expect((await account.read()).connected).toBe(false);
  expect((await account.start("chatgpt", done)).code).toBe("ABCD");
  expect(p.value.request).toHaveBeenCalledWith("account/login/start", {
    type: "chatgptDeviceCode",
  });
  p.notify("account/login/completed", { loginId: "other", success: true });
  expect(done).not.toHaveBeenCalled();
  p.notify("account/login/completed", { loginId: "login", success: true });
  expect(done).toHaveBeenCalledWith(undefined);
  await account.close();
  expect(p.value.close).toHaveBeenCalled();
});
it("respects Codex installations that do not require OpenAI authentication", async () => {
  const p = provider(async () => ({ account: null, requiresOpenaiAuth: false }));
  const account = new CodexAccount(p.value);
  expect((await account.read()).connected).toBe(true);
  await account.close();
});
it("uses OpenCode's headless OAuth and writes API keys through its auth API", async () => {
  let finish: () => void = () => undefined;
  const p = provider(async (method) => {
    if (method === "account/providers")
      return { all: [{ id: "openai", name: "OpenAI" }], connected: [] };
    if (method === "account/methods")
      return {
        openai: [
          { type: "oauth", label: "ChatGPT (browser)" },
          { type: "oauth", label: "ChatGPT (headless)" },
          { type: "api", label: "API key" },
        ],
      };
    if (method === "account/authorize")
      return {
        url: "https://auth.openai.com/codex/device",
        method: "auto",
        instructions: "Enter code ABCD",
      };
    if (method === "account/callback")
      return new Promise((resolve) => {
        finish = () => resolve({});
      });
    return {};
  });
  const account = new OpenCodeAccount(p.value, async () => []);
  const read = await account.read();
  expect(read.methods.map((m) => m.id)).toEqual(["openai:1", "openai:2"]);
  const done = vi.fn();
  expect((await account.start("openai:1", done)).url).toContain("auth.openai.com");
  finish();
  await vi.waitFor(() => expect(done).toHaveBeenCalled());
  expect((await account.start("openai:2", done)).input).toBe("api-key");
  await account.complete("secret-key");
  expect(p.value.request).toHaveBeenCalledWith("account/key", {
    provider: "openai",
    method: 2,
    kind: "api-key",
    value: "secret-key",
  });
  await account.close();
});
function child() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill() {
      this.signalCode = "SIGTERM";
      queueMicrotask(() => child.emit("close", null));
      return true;
    },
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}
it("reads Claude status and forwards a pasted code on stdin without a terminal", async () => {
  const children: ChildProcessWithoutNullStreams[] = [];
  const spawn = vi.fn<typeof launch>(() => {
    const c = child();
    children.push(c);
    return c;
  });
  const account = new ClaudeAccount("/project", spawn);
  const read = account.read();
  children[0]!.stdout.emit("data", Buffer.from('{"loggedIn":false}'));
  children[0]!.emit("close", 1);
  expect((await read).connected).toBe(false);
  const done = vi.fn();
  const started = account.start("claudeai", done);
  children[1]!.stdout.emit("data", Buffer.from("Visit: https://claude.ai/oauth/"));
  children[1]!.stdout.emit(
    "data",
    Buffer.from("authorize?state=state\nPaste code here if prompted > "),
  );
  expect((await started).url).toBe("https://claude.ai/oauth/authorize?state=state");
  let input = "";
  children[1]!.stdin.on("data", (data) => {
    input += String(data);
  });
  await account.complete("test-code");
  expect(input).toBe("test-code\n");
  await expect(account.complete("bad\ncode")).rejects.toThrow("Invalid");
  children[1]!.emit("close", 0);
  expect(done).toHaveBeenCalledWith(undefined);
  expect(spawn).toHaveBeenCalledWith("claude", ["auth", "login", "--claudeai"], "/project");
  await account.close();
});

it("does not mistake OpenCode free models for authenticated providers", async () => {
  const p = provider(async (method) =>
    method === "account/providers"
      ? { all: [{ id: "opencode", name: "OpenCode", source: "custom" }], connected: ["opencode"] }
      : {},
  );
  const anonymous = new OpenCodeAccount(p.value, async () => []);
  expect((await anonymous.read()).connected).toBe(false);
  await anonymous.close();
  const authenticated = new OpenCodeAccount(p.value, async () => ["opencode"]);
  expect((await authenticated.read()).connected).toBe(true);
  await authenticated.close();
});

it("serializes overlapping account starts while an earlier backend is closing", async () => {
  let release: () => void = () => undefined;
  const b = backend();
  b.close.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const factory = vi.fn(() => b);
  const accounts = new AgentAccounts(factory);
  await accounts.request("one", info, { type: "read" });
  const starting = accounts.request("one", info, { type: "start", methodId: "test" });
  await expect(accounts.request("one", info, { type: "start", methodId: "test" })).rejects.toThrow(
    "already in progress",
  );
  release();
  expect((await starting).status).toBe("pending");
  expect(factory).toHaveBeenCalledTimes(2);
  await accounts.close();
});
