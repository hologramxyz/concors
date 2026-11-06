import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import type { AgentOperation, WorkspaceOperation } from "@concors/protocol";
import { createDaemonServer, type DaemonServer } from "../server.ts";
import { loadDaemonConfig } from "../config.ts";
import { TestAgentProvider } from "../agents/testing/provider.ts";
import { TestAccountBackend } from "../agents/testing/account.ts";
import { createLogger } from "./log.ts";
import { attentionKind, createAttentionReporter, PromptSenders } from "./attention.ts";

describe("attentionKind", () => {
  it("notifies only when a turn that was running ends in a way someone should see", () => {
    expect(attentionKind("working", "done")).toBe("done");
    expect(attentionKind("starting", "needs_input")).toBe("needs_input");
    expect(attentionKind("working", "failed")).toBe("failed");
    // Stopped by the person themselves, or never running: nothing to say.
    expect(attentionKind("working", "interrupted")).toBeNull();
    expect(attentionKind("working", "idle")).toBeNull();
    expect(attentionKind(undefined, "done")).toBeNull();
    expect(attentionKind("done", "done")).toBeNull();
    expect(attentionKind("needs_input", "done")).toBeNull();
  });
});

describe("PromptSenders", () => {
  const request = (kind: string, sessionId = "s1") =>
    Buffer.from(
      JSON.stringify({
        type: "agent.request",
        requestId: randomUUID(),
        operation: { kind, sessionId, text: "hi" },
      }),
    );
  it("remembers who last sent, steered or queued a prompt in each chat", () => {
    const senders = new PromptSenders();
    senders.note(request("send"), "user_a");
    expect(senders.get("s1")).toBe("user_a");
    senders.note(request("steer"), "user_b");
    expect(senders.get("s1")).toBe("user_b");
    senders.note(request("queue-add", "s2"), "user_c");
    expect(senders.get("s2")).toBe("user_c");
    // Reading a chat is not writing to it.
    senders.note(request("read"), "user_d");
    expect(senders.get("s1")).toBe("user_b");
    // Other traffic is skipped without being parsed.
    senders.note(Buffer.from('{"type":"terminal.input","sessionId":"s1"}'), "user_e");
    senders.note(Buffer.from('{"type":"agent.request" broken'), "user_e");
    expect(senders.get("s1")).toBe("user_b");
  });
  it("forgets the least recently written chats past its limit", () => {
    const senders = new PromptSenders(2);
    senders.set("a", "1");
    senders.set("b", "2");
    senders.set("a", "3");
    senders.set("c", "4");
    expect([senders.get("a"), senders.get("b"), senders.get("c")]).toEqual(["3", undefined, "4"]);
  });
});

describe("createAttentionReporter", () => {
  let server: DaemonServer | undefined;
  let directory = "";
  const stops: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) await stop();
    await server?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function setup() {
    directory = await mkdtemp(join(tmpdir(), "concors-attention-"));
    server = createDaemonServer(loadDaemonConfig({ port: 0, logLevel: "silent" }, {}), {
      workspacePath: join(directory, "state.db"),
      accountBackendFactory: (info) => new TestAccountBackend(info),
      agentProviderFactory: (cwd, handler, id) => {
        const provider = new TestAgentProvider(handler, id);
        provider.cwd = cwd;
        return provider;
      },
    });
    const url = await server.listen();
    const client = new DaemonConnection({
      endpoint: describeDaemonEndpoint(url),
      client: { kind: "test", name: "attention", version: "0.0.0" },
    });
    stops.push(async () => client.disconnect());
    client.subscribeWorkspace(() => undefined);
    await client.connect();
    await expect.poll(() => client.workspace).not.toBeNull();
    const projectId = randomUUID(),
      tabId = randomUUID(),
      paneId = randomUUID();
    const command = (operation: WorkspaceOperation) =>
      client.executeWorkspace({
        type: "workspace.command",
        commandId: randomUUID(),
        epoch: client.workspace!.epoch,
        operation,
      });
    await command({ kind: "project.add", projectId, name: "Push", directory });
    await command({
      kind: "tab.create",
      projectId,
      tabId,
      paneId,
      expectedVersion: 0,
      name: "Chat",
      profile: "chat",
    });
    const start: AgentOperation = {
      kind: "start",
      epoch: client.workspace!.epoch,
      projectId,
      tabId,
      paneId,
      expectedVersion: 1,
    };
    expect((await client.requestAgent(start, randomUUID())).outcome.status).toBe("ok");
    await expect.poll(() => client.agents[0]?.status).toBe("idle");
    const sessionId = client.agents[0]!.id;
    const prompt = async (text: string, until: string) => {
      await client.requestAgent({ kind: "send", sessionId, text }, randomUUID());
      await expect.poll(() => client.agents[0]?.status).toBe(until);
    };
    const reports: { url: string; authorization: string; body: Record<string, unknown> }[] = [];
    let failNext = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (failNext > 0) {
        failNext -= 1;
        throw new Error("offline");
      }
      reports.push({
        url: String(input),
        authorization: (init?.headers as Record<string, string>)["authorization"] ?? "",
        body: JSON.parse(init?.body as string) as Record<string, unknown>,
      });
      return new Response('{"status":"sent"}');
    });
    const senders = new PromptSenders();
    const port = Number(new URL(url).port);
    const reporter = createAttentionReporter({
      controlPlaneUrl: "https://api.test",
      machineId: "machine_1",
      agentToken: "agent-secret",
      host: async () => ({ protocol: 1, pid: process.pid, port, token: "unused" }),
      senders,
      logger: createLogger(() => undefined),
      fetchImpl,
      retryMs: 20,
    });
    stops.push(() => reporter.stop());
    return {
      projectId,
      sessionId,
      prompt,
      reports,
      senders,
      reporter,
      failOnce: () => (failNext = 1),
      fetchImpl,
    };
  }

  it("reports a chat that finished, asks or fails, for whoever sent its prompt", async () => {
    const f = await setup();
    // Finished before the reporter was watching: not reported late.
    await f.prompt("first", "done");
    f.reporter.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(f.reports).toEqual([]);

    f.senders.set(f.sessionId, "user_7");
    await f.prompt("again", "done");
    await expect.poll(() => f.reports.length).toBe(1);
    expect(f.reports[0]).toMatchObject({
      url: "https://api.test/api/v1/agent/attention",
      authorization: "Bearer machine_1.agent-secret",
      body: { kind: "done", projectId: f.projectId, sessionId: f.sessionId, userId: "user_7" },
    });
    // Identifiers only: nothing from the conversation is sent.
    expect(Object.keys(f.reports[0]!.body).sort()).toEqual([
      "eventId",
      "kind",
      "projectId",
      "sessionId",
      "userId",
    ]);

    await f.prompt("question", "needs_input");
    await expect.poll(() => f.reports.at(-1)?.body["kind"]).toBe("needs_input");
  });

  it("retries a report that could not be sent, with the same event ID", async () => {
    const f = await setup();
    f.reporter.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    f.failOnce();
    await f.prompt("fail", "failed");
    await expect.poll(() => f.reports.length).toBe(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    const [first, second] = f.fetchImpl.mock.calls.map(
      ([, init]) => (JSON.parse(init?.body as string) as { eventId: string }).eventId,
    );
    expect(first).toBe(second);
    // No sender known (a schedule, or a prompt from before this gateway started).
    expect(f.reports[0]!.body).toMatchObject({ kind: "failed" });
    expect(f.reports[0]!.body).not.toHaveProperty("userId");
  });
});
