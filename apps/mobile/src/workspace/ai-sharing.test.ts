import { describe, expect, it, vi } from "vitest";
import type { AgentInfo, ClientMessage, ProviderStatus } from "@concors/protocol";
import {
  createAISharingPermission,
  createAISharingStore,
  requiresAISharingPermission,
  type AISharingDisclosure,
} from "./ai-sharing";
const id = "11111111-1111-4111-8111-111111111111";
const send = {
  type: "agent.request",
  requestId: id,
  operation: { kind: "send", sessionId: id, text: "private code" },
} as const;
function setup() {
  const provider: ProviderStatus = {
    id: "codex",
    label: "Work Codex",
    engine: "codex",
    enabled: true,
    command: ["codex", "--key=should-not-appear"],
    envKeys: ["OPENAI_API_KEY"],
    mcpServerNames: ["Issue tracker"],
    installed: true,
    customized: false,
    canInstall: false,
    installStatus: "installed",
  };
  const context = {
    agents: [{ id, provider: "codex", model: "model-a" }] as AgentInfo[],
    schedules: [],
    requestProvider: vi.fn(async (_operation: unknown, requestId: string) => ({
      type: "provider.result" as const,
      requestId,
      outcome: { status: "ok" as const, revision: 1, providers: [provider] },
    })),
  };
  const ask = vi.fn(async (_disclosure: AISharingDisclosure) => true);
  const changed = vi.fn();
  return {
    provider,
    context,
    ask,
    changed,
    permission: createAISharingPermission(context, ask, changed),
  };
}
describe("AI sharing permission at the native protocol boundary", () => {
  it("requires permission for history reads because opening saved history can resume a provider", async () => {
    const { permission, ask } = setup();
    ask.mockResolvedValue(false);
    expect(
      await permission.beforeSend({
        type: "agent.request",
        requestId: id,
        operation: { kind: "read", sessionId: id },
      }),
    ).toMatchObject({ outcome: { status: "error" } });
    expect(ask).toHaveBeenCalledOnce();
  });
  it("keeps history, stopping work and declining a tool usable without sending data to a provider", async () => {
    const { permission, ask, context } = setup();
    for (const operation of [
      { kind: "list-messages", sessionId: id },
      { kind: "interrupt", sessionId: id, turnId: "turn" },
      { kind: "respond", sessionId: id, pendingId: id, decision: "decline" },
    ] as const) {
      expect(
        await permission.beforeSend({ type: "agent.request", requestId: id, operation }),
      ).toBeNull();
    }
    expect(ask).not.toHaveBeenCalled();
    expect(context.requestProvider).not.toHaveBeenCalled();
  });
  it("names the configured recipients, data and model without exposing credentials", async () => {
    const { permission, ask } = setup();
    expect(await permission.beforeSend(send)).toBeNull();
    const text = ask.mock.calls[0]![0].details;
    const { summary } = ask.mock.calls[0]![0];
    expect(summary).toBe("Send prompts, code, files and chat context to OpenAI, Issue tracker?");
    expect(summary).not.toContain("private code");
    expect(summary).not.toContain("should-not-appear");
    for (const value of [
      "OpenAI",
      "Work Codex",
      "Issue tracker",
      "Models:",
      "attachments",
      "retention",
    ])
      expect(text).toContain(value);
    expect(text).not.toContain("private code");
    expect(text).not.toContain("should-not-appear");
  });
  it("reuses permission across models and asks again when the provider configuration changes", async () => {
    const { permission, ask, context } = setup();
    await permission.beforeSend(send);
    await permission.beforeSend(send);
    expect(ask).toHaveBeenCalledOnce();
    context.agents[0]!.model = "model-b";
    await permission.beforeSend(send);
    expect(ask).toHaveBeenCalledOnce();
    context.requestProvider.mockImplementation(async (_op, requestId) => ({
      type: "provider.result",
      requestId,
      outcome: { status: "ok", revision: 2, providers: [setup().provider] },
    }));
    await permission.beforeSend(send);
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it("asks once when seven conversations using different models restore together", async () => {
    const { permission, ask, context } = setup();
    context.agents = Array.from({ length: 7 }, (_, i) => ({
      ...context.agents[0]!,
      id: `session-${i}`,
      model: `model-${i}`,
    }));
    const replies = await Promise.all(
      context.agents.map((agent) =>
        permission.beforeSend({
          ...send,
          operation: { kind: "read", sessionId: agent.id },
        }),
      ),
    );
    expect(replies).toEqual(Array(7).fill(null));
    expect(ask).toHaveBeenCalledOnce();
  });
  it("names all enabled services once, so switching agents does not ask repeatedly", async () => {
    const { permission, ask, context, provider } = setup();
    const second = { ...provider, id: "claude", engine: "claude" as const, label: "Work Claude" };
    context.requestProvider.mockResolvedValue({
      type: "provider.result",
      requestId: id,
      outcome: { status: "ok", revision: 1, providers: [second, provider] },
    });
    await permission.beforeSend(send);
    context.agents[0]!.provider = "claude";
    context.requestProvider.mockResolvedValue({
      type: "provider.result",
      requestId: id,
      outcome: { status: "ok", revision: 1, providers: [provider, second] },
    });
    expect(await permission.beforeSend(send)).toBeNull();
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0]![0].details).toContain("Anthropic");
    expect(ask.mock.calls[0]![0].details).toContain("OpenAI");
  });
  it("keeps an individual provider usable when the machine has more than twelve configured services", async () => {
    const { permission, ask, context, provider } = setup();
    const others = Array.from({ length: 12 }, (_, i) => ({ ...provider, id: `other-${i}` }));
    context.requestProvider.mockResolvedValue({
      type: "provider.result",
      requestId: id,
      outcome: { status: "ok", revision: 1, providers: [provider, ...others] },
    });
    expect(await permission.beforeSend(send)).toBeNull();
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0]![0].details).toContain("Work Codex");
  });
  it("remembers approval after reconnect and after loading the device record again", async () => {
    const { context, ask } = setup();
    let saved: string | null = null;
    const storage = {
      read: async () => saved,
      write: async (value: string) => {
        saved = value;
      },
    };
    const store = createAISharingStore(storage);
    const first = createAISharingPermission(context, ask, undefined, store);
    expect(await first.beforeSend(send)).toBeNull();
    first.dispose();
    const reconnected = createAISharingPermission(context, ask, undefined, store);
    expect(await reconnected.beforeSend(send)).toBeNull();
    reconnected.dispose();
    const relaunched = createAISharingPermission(
      context,
      ask,
      undefined,
      createAISharingStore(storage),
    );
    expect(await relaunched.beforeSend(send)).toBeNull();
    expect(ask).toHaveBeenCalledOnce();
    // A different account/machine has its own storage, so needs its own approval.
    const other = createAISharingPermission(
      context,
      ask,
      undefined,
      createAISharingStore({
        read: async () => null,
        write: async () => undefined,
      }),
    );
    await other.beforeSend(send);
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it("does not open a second prompt if the transport reconnects while one is showing", async () => {
    const { context, ask } = setup();
    const store = createAISharingStore({ read: async () => null, write: async () => undefined });
    let approve!: (value: boolean) => void;
    ask.mockImplementation(
      () =>
        new Promise((resolve) => {
          approve = resolve;
        }),
    );
    const first = createAISharingPermission(context, ask, undefined, store);
    const oldRequest = first.beforeSend(send);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    first.dispose();
    const next = createAISharingPermission(context, ask, undefined, store);
    const newRequest = next.beforeSend(send);
    await vi.waitFor(() => expect(context.requestProvider).toHaveBeenCalledTimes(2));
    approve(true);
    expect(await oldRequest).toMatchObject({ outcome: { status: "error" } });
    expect(await newRequest).toBeNull();
    expect(ask).toHaveBeenCalledOnce();
  });
  it("keeps withdrawal after reconnect until permission is explicitly reviewed", async () => {
    const { context, ask } = setup();
    let saved: string | null = null;
    const store = createAISharingStore({
      read: async () => saved,
      write: async (value) => {
        saved = value;
      },
    });
    const first = createAISharingPermission(context, ask, undefined, store);
    await first.beforeSend(send);
    await first.withdraw();
    first.dispose();
    const next = createAISharingPermission(context, ask, undefined, store);
    expect(await next.beforeSend(send)).toMatchObject({ outcome: { status: "error" } });
    expect(ask).toHaveBeenCalledOnce();
    await next.review();
    expect(await next.beforeSend(send)).toBeNull();
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it("writes withdrawal after an approval that is still being saved", async () => {
    const { context, ask } = setup();
    let finishSave!: () => void;
    let saved: string | null = null;
    const write = vi.fn(async (value: string) => {
      if (!saved)
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
      saved = value;
    });
    const store = createAISharingStore({ read: async () => saved, write });
    const permission = createAISharingPermission(context, ask, undefined, store);
    const request = permission.beforeSend(send);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const withdrawal = permission.withdraw();
    finishSave();
    await withdrawal;
    expect(await request).toMatchObject({ outcome: { status: "error" } });
    expect(JSON.parse(saved!)).toEqual({ blocked: true, grant: null });
    const next = createAISharingPermission(
      context,
      ask,
      undefined,
      createAISharingStore({
        read: async () => saved,
        write,
      }),
    );
    expect(await next.beforeSend(send)).toMatchObject({ outcome: { status: "error" } });
    expect(ask).toHaveBeenCalledOnce();
  });
  it("asks again after the persisted configuration changes", async () => {
    const { context, ask, provider } = setup();
    let saved: string | null = null;
    const storage = {
      read: async () => saved,
      write: async (value: string) => {
        saved = value;
      },
    };
    const first = createAISharingPermission(context, ask, undefined, createAISharingStore(storage));
    await first.beforeSend(send);
    first.dispose();
    context.requestProvider.mockResolvedValue({
      type: "provider.result",
      requestId: id,
      outcome: { status: "ok", revision: 2, providers: [provider] },
    });
    const next = createAISharingPermission(context, ask, undefined, createAISharingStore(storage));
    expect(await next.beforeSend(send)).toBeNull();
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it("settles the original request with an error when permission is declined", async () => {
    const { permission, ask } = setup();
    ask.mockResolvedValue(false);
    expect(await permission.beforeSend(send)).toMatchObject({
      type: "agent.result",
      requestId: id,
      outcome: { status: "error" },
    });
  });
  it("withdraws permission immediately, including an approval still in flight", async () => {
    const { permission, ask, changed } = setup();
    let approve!: (value: boolean) => void;
    ask.mockImplementation(
      () =>
        new Promise((resolve) => {
          approve = resolve;
        }),
    );
    const waiting = permission.beforeSend(send);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    await permission.withdraw();
    approve(true);
    expect(await waiting).toMatchObject({ outcome: { status: "error" } });
    expect(await permission.beforeSend(send)).toMatchObject({ outcome: { status: "error" } });
    expect(ask).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith("blocked");
    await permission.review();
    ask.mockResolvedValue(true);
    expect(await permission.beforeSend(send)).toBeNull();
  });
  it("does not approve a request after the account or machine connection was disposed", async () => {
    const { permission, ask } = setup();
    let approve!: (value: boolean) => void;
    ask.mockImplementation(
      () =>
        new Promise((resolve) => {
          approve = resolve;
        }),
    );
    const waiting = permission.beforeSend(send);
    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce());
    permission.dispose();
    approve(true);
    expect(await waiting).toMatchObject({ outcome: { status: "error" } });
  });
  it("fails closed when recipients cannot be discovered", async () => {
    const { permission, context, ask } = setup();
    context.requestProvider.mockRejectedValue(new Error("offline"));
    expect(await permission.beforeSend(send)).toMatchObject({ outcome: { status: "error" } });
    expect(ask).not.toHaveBeenCalled();
  });
  it("guards scheduled work and queue resumption, while permitting schedule deletion", async () => {
    const { permission, ask } = setup();
    ask.mockResolvedValue(false);
    const operation = { kind: "queue-pause", sessionId: id, paused: false } as const;
    expect(
      await permission.beforeSend({ type: "agent.request", requestId: id, operation }),
    ).toMatchObject({ outcome: { status: "error" } });
    const schedule = {
      type: "schedule.request",
      requestId: id,
      operation: { kind: "run", id },
    } as const;
    expect(await permission.beforeSend(schedule)).toMatchObject({
      type: "schedule.result",
      outcome: { status: "error" },
    });
    expect(
      await permission.beforeSend({
        ...schedule,
        operation: { kind: "delete", id, expectedRevision: 1 },
      } as ClientMessage),
    ).toBeNull();
  });
});

describe("AI sharing platform scope", () => {
  it.each(["web", "android", "macos", "windows"])("does not gate AI requests on %s", (platform) => {
    expect(requiresAISharingPermission(platform, false)).toBe(false);
  });
  it("requires consent only in the real iOS workspace", () => {
    expect(requiresAISharingPermission("ios", false)).toBe(true);
    expect(requiresAISharingPermission("ios", true)).toBe(false);
  });
});

it("passes the disclosed recipients to Supervisor on both fresh and reused consent", async () => {
  const { permission } = setup();
  for (let attempt = 0; attempt < 2; attempt++) {
    const message: ClientMessage = { ...send, requestId: crypto.randomUUID() };
    expect(await permission.beforeSend(message)).toBeNull();
    expect(message).toMatchObject({ sharing: { revision: 1, providers: ["codex"] } });
  }
});
it("withdraws Supervisor's daemon grant when native iOS consent is withdrawn", async () => {
  const { context, ask } = setup();
  const requestSupervisor = vi.fn(async (_op: unknown, requestId: string) => ({
    type: "supervisor.result" as const,
    requestId,
    outcome: { status: "ok" as const, deliveries: [] },
  }));
  const permission = createAISharingPermission(
    {
      ...context,
      requestSupervisor,
      state: {
        status: "ready",
        daemon: {
          status: "ready",
          protocolVersion: "v1",
          daemonVersion: "test",
          capabilities: ["supervisor-v1"],
        },
      },
    },
    ask,
  );
  await permission.withdraw();
  expect(requestSupervisor).toHaveBeenCalledWith({ kind: "revoke-sharing" }, expect.any(String));
});
