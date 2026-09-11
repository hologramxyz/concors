import { afterEach, expect, it, vi } from "vitest";
import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentInfo, AgentProviderCatalog, AgentResult } from "@concors/protocol";
import { ModelCatalog, modelCatalog, invalidateModelCatalogs } from "./model-catalog";
const agent = {
  id: "session",
  provider: "codex",
  directory: "/project",
  threadId: "thread",
} as AgentInfo;
const row = (id: string, label = id): AgentProviderCatalog => ({
  id,
  loaded: true,
  models: [{ id: `${id}-model`, label, efforts: [], defaultEffort: null }],
});
const result = (providers: AgentProviderCatalog[]) =>
  ({ outcome: { status: "ok", providers } }) as AgentResult;
function setup() {
  const requestAgent = vi.fn(async () => result([row("codex"), row("claude")]));
  const connection = {
    state: { status: "ready", daemon: { capabilities: ["agent-providers"] } },
    workspace: { epoch: "machine-epoch" },
    requestAgent,
  } as unknown as DaemonConnection;
  return { connection, requestAgent, cache: new ModelCatalog(connection) };
}
afterEach(() => vi.restoreAllMocks());
it("coalesces requests and reuses provider/model results across repeated openings and sessions", async () => {
  const { cache, requestAgent } = setup();
  await Promise.all([cache.load(agent), cache.load(agent)]);
  expect(requestAgent).toHaveBeenCalledTimes(1);
  await cache.load(agent, "claude");
  const calls = requestAgent.mock.calls.length;
  await cache.load({ ...agent, id: "another-session" }, "claude");
  await cache.load(agent);
  expect(requestAgent).toHaveBeenCalledTimes(calls);
  expect(cache.getSnapshot().pending).toEqual([]);
});
it("keeps cached rows visible while refreshing and after discovery errors", async () => {
  const { cache, requestAgent } = setup();
  await cache.load(agent, "claude");
  let finish: (value: AgentResult) => void = () => undefined;
  requestAgent.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const refresh = cache.load(agent, "claude", true);
  expect(cache.getSnapshot().providers[1]?.models[0]?.id).toBe("claude-model");
  finish(
    result([row("codex"), { id: "claude", loaded: true, models: [], error: "Temporary outage" }]),
  );
  await refresh;
  expect(cache.getSnapshot().providers[1]).toMatchObject({
    models: [{ id: "claude-model" }],
    error: "Temporary outage",
  });
});
it("isolates machines and projects and rejects results from before an invalidation", async () => {
  const { connection, requestAgent } = setup();
  const cache = modelCatalog(connection, "/project");
  expect(modelCatalog(connection, "/project")).toBe(cache);
  expect(modelCatalog(connection, "/elsewhere")).not.toBe(cache);
  expect(modelCatalog(setup().connection, "/project")).not.toBe(cache);
  let finish: (value: AgentResult) => void = () => undefined;
  requestAgent.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = cache.load(agent);
  invalidateModelCatalogs(connection);
  finish(result([row("claude", "Old account model")]));
  await first;
  expect(cache.getSnapshot().providers).toEqual([]);
  await cache.load(agent);
  expect(cache.getSnapshot().providers[1]?.models[0]?.label).toBe("claude");
});
it("warms provider lists and models without duplicate work", async () => {
  const { cache, requestAgent } = setup();
  requestAgent.mockImplementation(async (operation?: unknown) => {
    const provider = (operation as { provider?: string })?.provider;
    return result([
      row("codex"),
      provider === "claude" ? row("claude") : { id: "claude", models: [], loaded: false },
    ]);
  });
  await Promise.all([cache.warm(agent), cache.warm(agent)]);
  expect(requestAgent).toHaveBeenCalledTimes(2);
  await cache.load(agent, "claude");
  expect(requestAgent).toHaveBeenCalledTimes(2);
  expect(cache.getSnapshot().providers[1]?.loaded).toBe(true);
});
