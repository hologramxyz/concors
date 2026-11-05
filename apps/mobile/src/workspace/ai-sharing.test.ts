import { describe, expect, it, vi } from "vitest";
import type { AgentInfo, ClientMessage, ProviderStatus } from "@concors/protocol";
import { createAISharingPermission } from "./ai-sharing";
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
  const ask = vi.fn(async (_disclosure: string) => true);
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
    const text = ask.mock.calls[0]![0];
    for (const value of [
      "OpenAI",
      "Work Codex",
      "Issue tracker",
      "model-a",
      "attachments",
      "retention",
    ])
      expect(text).toContain(value);
    expect(text).not.toContain("private code");
    expect(text).not.toContain("should-not-appear");
  });
  it("reuses a grant only for the same model/configuration on this connection", async () => {
    const { permission, ask, context } = setup();
    await permission.beforeSend(send);
    await permission.beforeSend(send);
    expect(ask).toHaveBeenCalledOnce();
    context.agents[0]!.model = "model-b";
    await permission.beforeSend(send);
    expect(ask).toHaveBeenCalledTimes(2);
    context.requestProvider.mockImplementation(async (_op, requestId) => ({
      type: "provider.result",
      requestId,
      outcome: { status: "ok", revision: 2, providers: [setup().provider] },
    }));
    await permission.beforeSend(send);
    expect(ask).toHaveBeenCalledTimes(3);
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
    permission.withdraw();
    approve(true);
    expect(await waiting).toMatchObject({ outcome: { status: "error" } });
    expect(await permission.beforeSend(send)).toMatchObject({ outcome: { status: "error" } });
    expect(ask).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith("blocked");
    permission.review();
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
