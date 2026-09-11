import { describe, expect, it, vi } from "vitest";

import { createHeartbeat } from "./heartbeat.ts";
import { createLogger } from "./log.ts";

describe("heartbeat", () => {
  it("posts version, uptime and session count with the agent credential", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    const heartbeat = createHeartbeat({
      controlPlaneUrl: "https://api.example.test",
      machineId: "machine_1",
      agentToken: "secret",
      version: "0.1.0",
      countSessions: () => Promise.resolve(2),
      logger: createLogger(() => undefined),
      fetchImpl: fetchImpl,
    });

    await heartbeat.beat();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/v1/agent/heartbeat");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer machine_1.secret" });
    expect(JSON.parse(init.body as string)).toMatchObject({ version: "0.1.0", sessions: 2 });
  });

  it("logs the first failure and keeps going", async () => {
    const lines: string[] = [];
    const heartbeat = createHeartbeat({
      controlPlaneUrl: "https://api.example.test",
      machineId: "machine_1",
      agentToken: "secret",
      version: "0.1.0",
      countSessions: () => Promise.reject(new Error("tmux gone")),
      logger: createLogger((line) => lines.push(line)),
      fetchImpl: () => Promise.resolve(new Response("", { status: 503 })),
    });

    await heartbeat.beat();
    await heartbeat.beat();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("heartbeat failed");
    expect(lines[0]).toContain("503");
  });
});

it("beats immediately and every 30 seconds, stops on shutdown, and sets a ten-second timeout", async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const heartbeat = createHeartbeat({
    controlPlaneUrl: "https://api.test",
    machineId: "machine",
    agentToken: "secret",
    version: "0.1.0",
    countSessions: async () => 3,
    logger: createLogger(() => undefined),
    fetchImpl,
  });
  try {
    heartbeat.start();
    heartbeat.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(10_000);
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({ version: "0.1.0", sessions: 3, uptimeSeconds: expect.any(Number) });
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    heartbeat.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  } finally {
    heartbeat.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

it("logs only the first and every tenth failure, then recovery", async () => {
  const lines: string[] = [];
  let status = 503;
  const heartbeat = createHeartbeat({
    controlPlaneUrl: "https://api.test",
    machineId: "machine",
    agentToken: "secret",
    version: "0.1.0",
    countSessions: async () => 0,
    logger: createLogger((line) => lines.push(line)),
    fetchImpl: async () => new Response("{}", { status }),
  });
  for (let i = 0; i < 21; i++) await heartbeat.beat();
  expect(lines.map((line) => JSON.parse(line).failures)).toEqual([1, 10, 20]);
  status = 200;
  await heartbeat.beat();
  expect(JSON.parse(lines[3]!)).toMatchObject({ failures: 21, message: "heartbeat back" });
  expect(lines.join()).not.toContain("secret");
});

it("does not send after shutdown while waiting for the session count", async () => {
  let finishCount: (count: number) => void = () => undefined;
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
  const heartbeat = createHeartbeat({
    controlPlaneUrl: "https://api.test",
    machineId: "machine",
    agentToken: "secret",
    version: "0.1.0",
    countSessions: () =>
      new Promise((resolve) => {
        finishCount = resolve;
      }),
    logger: createLogger(() => undefined),
    fetchImpl,
  });
  heartbeat.start();
  const pending = heartbeat.beat();
  heartbeat.stop();
  finishCount(2);
  await pending;
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("aborts an in-flight heartbeat on shutdown without logging its credential", async () => {
  let signal: AbortSignal | undefined;
  const lines: string[] = [];
  const heartbeat = createHeartbeat({
    controlPlaneUrl: "https://api.test",
    machineId: "machine",
    agentToken: "secret",
    version: "0.1.0",
    countSessions: async () => 0,
    logger: createLogger((line) => lines.push(line)),
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener("abort", () => reject(new Error("secret")));
      }),
  });
  const pending = heartbeat.beat();
  await expect.poll(() => signal).toBeDefined();
  heartbeat.stop();
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(lines).toHaveLength(0);
});

it("includes resource samples, and still heartbeats when collection fails", async () => {
  const resources = { memory: { totalBytes: 8192, availableBytes: 4096 }, disk: null };
  const collectResources = vi
    .fn()
    .mockResolvedValueOnce(resources)
    .mockRejectedValueOnce(new Error("read failed"));
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));
  const heartbeat = createHeartbeat({
    controlPlaneUrl: "https://api.test",
    machineId: "m1",
    agentToken: "secret",
    version: "0.2.0",
    countSessions: async () => 1,
    collectResources,
    fetchImpl,
    logger: createLogger(() => undefined),
  });
  await heartbeat.beat();
  await heartbeat.beat();
  expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string).resources).toEqual(resources);
  expect(JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string)).toMatchObject({
    sessions: 1,
    resources: null,
  });
});
