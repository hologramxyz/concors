import { afterEach, expect, it, vi } from "vitest";
import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentPlanUsage, AgentResult } from "@concors/protocol";
import { PlanUsageStore } from "./plan-usage";

const sessionId = crypto.randomUUID();
const usage: AgentPlanUsage = {
  provider: "claude",
  status: "available",
  planLabel: "Max",
  message: null,
  windows: [{ id: "five-hour", label: "Session", usedPercent: 42, resetsAt: null }],
  fetchedAt: Date.now(),
};
const reply = (outcome: AgentResult["outcome"]): AgentResult => ({
  type: "agent.result",
  requestId: crypto.randomUUID(),
  outcome,
});
const ok = (value: AgentPlanUsage = usage) =>
  reply({
    status: "ok",
    conversation: { agent: { id: sessionId } as never, items: [], hasMore: false },
    usage: value,
  });
function setup(capabilities = ["agent-plan-usage"]) {
  const connection = {
    state: {
      status: "ready",
      daemon: { protocolVersion: "v1", daemonVersion: "0.4.3", status: "ready", capabilities },
    } as DaemonConnection["state"],
    requestAgent: vi.fn<DaemonConnection["requestAgent"]>().mockResolvedValue(ok()),
  };
  return { connection, store: new PlanUsageStore(connection) };
}
afterEach(() => vi.restoreAllMocks());

it("asks once per provider and reuses the answer while the machine still caches it", async () => {
  const { store, connection } = setup();
  store.refresh("claude", sessionId);
  store.refresh("claude", crypto.randomUUID());
  await vi.waitFor(() => expect(store.getSnapshot().get("claude")?.usage).toEqual(usage));
  expect(connection.requestAgent).toHaveBeenCalledTimes(1);
  expect(connection.requestAgent.mock.calls[0]?.[0]).toEqual({ kind: "usage", sessionId });
  store.refresh("claude", sessionId);
  expect(connection.requestAgent).toHaveBeenCalledTimes(1);
  // Another provider is another account.
  store.refresh("codex", sessionId);
  expect(connection.requestAgent).toHaveBeenCalledTimes(2);
  // Asking again explicitly, as the refresh control does, always asks.
  store.refresh("claude", sessionId, true);
  expect(connection.requestAgent).toHaveBeenCalledTimes(3);
});

it("keeps the last windows when a refresh fails, and says why", async () => {
  const { store, connection } = setup();
  store.refresh("claude", sessionId);
  await vi.waitFor(() => expect(store.getSnapshot().get("claude")?.usage).toEqual(usage));
  connection.requestAgent.mockResolvedValueOnce(
    reply({ status: "error", message: "Claude Code is not running." }),
  );
  store.refresh("claude", sessionId, true);
  await vi.waitFor(() =>
    expect(store.getSnapshot().get("claude")).toMatchObject({
      usage,
      loading: false,
      error: "Claude Code is not running.",
    }),
  );
});

it("never asks a machine that cannot answer", () => {
  const older = setup([]);
  older.store.refresh("claude", sessionId);
  expect(older.connection.requestAgent).not.toHaveBeenCalled();
  expect(older.store.supported).toBe(false);
  expect(older.store.getSnapshot().size).toBe(0);
});
