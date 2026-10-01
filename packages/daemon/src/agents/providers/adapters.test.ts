import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { AcpProvider } from "./acp.ts";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { query, Query, Options } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeProvider } from "./claude.ts";
import { OpenCodeProvider, resumableOpenCodeSessions } from "./opencode.ts";
import { PiProvider } from "./pi.ts";
import { launch } from "./launch.ts";
import { object, type ConversationProvider } from "./contract.ts";
import { AGENT_INSTRUCTIONS } from "../instructions.ts";

vi.mock("./launch.ts", () => ({ launch: vi.fn() }));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
const turn = {
  model: null,
  input: [{ type: "text", text: "hello" }],
  sandboxPolicy: { type: "workspaceWrite" },
};
function observe(provider: ConversationProvider) {
  const notifications: { method: string; params: Record<string, unknown> }[] = [];
  const failures: Error[] = [];
  provider.onNotification((method, params) =>
    notifications.push({ method, params: object(params) }),
  );
  provider.onFailure((error) => failures.push(error));
  cleanup.push(() => provider.close());
  return { notifications, failures };
}
function child() {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null as NodeJS.Signals | null,
    killed: false,
    kill() {
      if (!this.killed) {
        this.killed = true;
        this.signalCode = "SIGTERM";
        queueMicrotask(() => {
          process.emit("exit", null, "SIGTERM");
          process.emit("close", null, "SIGTERM");
        });
      }
      return true;
    },
  });
  return process as unknown as ChildProcessWithoutNullStreams;
}
it("maps Claude streaming and tool decisions, interrupts, and resumes the native session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-claude-adapter-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, process.platform === "win32" ? "claude.cmd" : "claude"), "", {
    mode: 0o755,
  });
  vi.stubEnv("PATH", directory);
  let options: Options;
  let emit: (value: unknown) => void = () => undefined;
  const interrupts = vi.fn(async () => undefined);
  const createQuery = vi.fn(({ options: inputOptions }: Parameters<typeof query>[0]) => {
    options = inputOptions!;
    const messages = new PassThrough({ objectMode: true });
    emit = (value) => {
      messages.write(value);
    };
    return Object.assign(messages, {
      initializationResult: async () => ({
        models: [{ value: "default", displayName: "Default", resolvedModel: "claude-opus-5" }],
      }),
      supportedModels: async () => [
        {
          value: "claude-fable-5-1[1m]",
          displayName: "Fable",
          resolvedModel: "claude-fable-5-1",
        },
        { value: "sonnet", displayName: "Sonnet", resolvedModel: "claude-sonnet-5" },
      ],
      getContextUsage: async () => ({ model: "claude-sonnet-5" }),
      setModel: async () => undefined,
      setPermissionMode: async () => undefined,
      interrupt: interrupts,
      close: () => {
        messages.end();
      },
    }) as unknown as Query;
  });
  const input = vi.fn(async (): Promise<Record<string, unknown>> => ({ decision: "decline" }));
  const provider = new ClaudeProvider(directory, input, createQuery);
  const { notifications, failures } = observe(provider);
  await provider.initialize();
  const session = object(await provider.request("thread/start"));
  expect(session["model"]).toBe("claude-sonnet-5");
  expect(await provider.request("model/list")).toMatchObject({
    data: [
      { model: "claude-fable-5-1[1m]", resolvedModel: "claude-fable-5-1" },
      {
        model: "claude-fable-5",
        displayName: "Fable 5",
        resolvedModel: "claude-fable-5",
      },
      { model: "sonnet", resolvedModel: "claude-sonnet-5" },
    ],
  });
  await provider.request("turn/start", turn);
  expect(options!.permissionMode).toBe("default");
  expect(options!.allowDangerouslySkipPermissions).toBeUndefined();
  emit({ type: "stream_event", event: { type: "message_start", message: { id: "a" } } });
  emit({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
  });
  emit({
    type: "assistant",
    message: { id: "a", model: "claude-opus-5-1", content: [{ type: "text", text: "Hello" }] },
  });
  await expect
    .poll(() =>
      notifications.some(
        (n) => n.method === "item/completed" && object(n.params["item"])["text"] === "Hello",
      ),
    )
    .toBe(true);
  expect(notifications).toContainEqual(
    expect.objectContaining({
      method: "session/model/updated",
      params: expect.objectContaining({ model: "claude-opus-5-1" }),
    }),
  );
  emit({
    type: "assistant",
    message: {
      id: "tasks-a",
      content: [
        {
          type: "tool_use",
          id: "todo",
          name: "TodoWrite",
          input: { todos: [{ content: "Verify native plans", status: "in_progress" }] },
        },
      ],
    },
  });
  emit({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "todo", content: "Updated" }] },
  });
  emit({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "thinking_delta", thinking: "Checking results" },
    },
  });
  await expect
    .poll(() => notifications.some((n) => object(n.params["item"] ?? {})["type"] === "plan"))
    .toBe(true);
  expect(notifications.some((n) => JSON.stringify(n.params).includes("Checking results"))).toBe(
    true,
  );
  // Block 1 streamed; Claude Code then sends it alone, where it is block 0 of that entry.
  emit({
    type: "assistant",
    message: { id: "a", content: [{ type: "thinking", thinking: "Checking results" }] },
  });
  await expect
    .poll(() =>
      notifications.some(
        (n) => n.method === "item/completed" && object(n.params["item"])["type"] === "reasoning",
      ),
    )
    .toBe(true);
  expect(
    new Set(
      notifications
        .map((n) => object(n.params["item"] ?? {}))
        .filter((item) => item["type"] === "reasoning")
        .map((item) => item["id"]),
    ),
  ).toEqual(new Set(["a:thinking:0"]));
  const decision = await options!.canUseTool!(
    "Bash",
    { command: "echo test" },
    { signal: new AbortController().signal, toolUseID: "tool", requestId: "request" },
  );
  expect(decision?.behavior).toBe("deny");
  expect(input).toHaveBeenCalledOnce();
  input.mockResolvedValueOnce({ decision: "decline" });
  expect(
    (
      await options!.canUseTool!(
        "AskUserQuestion",
        { questions: [{ header: "Scope", question: "Where?", options: [] }] },
        { signal: new AbortController().signal, toolUseID: "q", requestId: "q" },
      )
    )?.behavior,
  ).toBe("deny");
  input.mockResolvedValueOnce({ decision: "accept", actionId: "implement" });
  expect(
    (
      await options!.canUseTool!(
        "ExitPlanMode",
        { plan: "## Plan\nReview tests" },
        { signal: new AbortController().signal, toolUseID: "plan", requestId: "plan" },
      )
    )?.behavior,
  ).toBe("allow");
  expect(input).toHaveBeenLastCalledWith(
    "item/commandExecution/requestApproval",
    expect.objectContaining({ approvalKind: "plan", plan: "## Plan\nReview tests" }),
    expect.any(String),
  );
  await provider.request("turn/interrupt");
  expect(interrupts).toHaveBeenCalledOnce();
  expect(
    object(notifications.findLast((n) => n.method === "turn/completed")!.params["turn"])["status"],
  ).toBe("interrupted");
  const threadId = object(session["thread"])["id"];
  await provider.request("thread/resume", { threadId });
  expect(options!.resume).toBe(threadId);
  await provider.request("command/execute", { ...turn, name: "compact", args: "Keep decisions" });
  emit({ type: "system", subtype: "status", status: "compacting" });
  emit({
    type: "system",
    subtype: "compact_boundary",
    uuid: "boundary",
    compact_metadata: { post_tokens: 123 },
  });
  emit({ type: "system", subtype: "compact_boundary", uuid: "boundary" });
  emit({ type: "result", is_error: false });
  await expect
    .poll(
      () =>
        notifications.filter(
          (n) =>
            n.method === "item/completed" &&
            object(n.params["item"])["type"] === "contextCompaction",
        ).length,
    )
    .toBe(1);
  expect(
    notifications.some(
      (n) =>
        n.method === "thread/tokenUsage/updated" &&
        object(object(n.params["tokenUsage"])["last"])["totalTokens"] === 123,
    ),
  ).toBe(true);
  expect(failures).toEqual([]);
});

it("leaves an unsaved Claude conversation to the caller and starts afresh after it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-claude-missing-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, process.platform === "win32" ? "claude.cmd" : "claude"), "", {
    mode: 0o755,
  });
  vi.stubEnv("PATH", directory);
  const opened: Options[] = [];
  const createQuery = vi.fn(({ options }: Parameters<typeof query>[0]) => {
    opened.push(options!);
    const messages = new PassThrough({ objectMode: true });
    const missing = new Error(
      `Claude Code returned an error result: No conversation found with session ID: ${options!.resume}`,
    );
    // Like the SDK, the stream fails before initialization is rejected.
    if (options!.resume) messages.destroy(missing);
    return Object.assign(messages, {
      initializationResult: async () => {
        if (options!.resume) throw missing;
        return { models: [{ value: "default", displayName: "Default" }] };
      },
      getContextUsage: async () => ({ model: "claude-sonnet-5" }),
      close: () => {
        messages.end();
      },
    }) as unknown as Query;
  });
  const provider = new ClaudeProvider(directory, vi.fn(), createQuery);
  const { failures } = observe(provider);
  await provider.initialize();
  await expect(provider.request("thread/resume", { threadId: "unsaved" })).rejects.toThrow(
    "No conversation found with session ID: unsaved",
  );
  const thread = object(object(await provider.request("thread/start"))["thread"]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(failures).toEqual([]);
  expect(opened.map((o) => o.resume ?? null)).toEqual([null, "unsaved", null]);
  expect(opened.map((o) => o.systemPrompt)).toEqual(
    Array(3).fill({ type: "preset", preset: "claude_code", append: AGENT_INSTRUCTIONS }),
  );
  expect(thread["id"]).toBe(opened[2]!.sessionId);
  expect(thread["id"]).not.toBe("unsaved");
});
it("offers only OpenCode conversations someone wrote in, in this directory", () => {
  const session = (id: string, extra: object = {}) => ({
    id,
    title: id,
    directory: "/repo",
    time: { created: 1000, updated: 2000 },
    ...extra,
  });
  expect(
    resumableOpenCodeSessions(
      [
        session("talked"),
        session("never-used", { time: { created: 1000, updated: 1000 } }),
        session("sub-agent", { parentID: "talked" }),
        session("elsewhere", { directory: "/other" }),
      ],
      "/repo",
    ),
  ).toEqual([
    { id: "talked", title: "talked", directory: "/repo", updatedAt: new Date(2000).toISOString() },
  ]);
});
it("reads OpenCode SSE deltas, scopes events, forwards decisions, and interrupts", async () => {
  let stream: ServerResponse;
  const requests: { path: string; body: unknown; auth: string | undefined }[] = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    if (path === "/event") {
      stream = res;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"server.connected","properties":{}}\n\n');
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    requests.push({ path, body: raw ? JSON.parse(raw) : null, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        path === "/provider"
          ? {
              connected: ["own-account"],
              all: [
                { id: "own-account", models: { m: { id: "model", name: "My model" } } },
                { id: "unconnected", models: { x: { id: "hidden", name: "Hidden" } } },
              ],
            }
          : path.endsWith("/summarize")
            ? true
            : path === "/session"
              ? { id: "session" }
              : {},
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  vi.mocked(launch).mockImplementation(() => {
    const process = child();
    queueMicrotask(() =>
      process.stdout.push(`server listening on http://127.0.0.1:${address.port}\n`),
    );
    return process;
  });
  const input = vi.fn(async (): Promise<Record<string, unknown>> => ({ decision: "decline" }));
  const provider = new OpenCodeProvider(tmpdir(), input);
  const { notifications, failures } = observe(provider);
  await provider.initialize();
  expect(await provider.request("model/list")).toMatchObject({
    data: [{ model: "own-account/model" }],
  });
  await provider.request("thread/start");
  await provider.request("turn/start", { ...turn, model: "own-account/model" });
  const event = (type: string, properties: unknown) =>
    stream!.write(`data: ${JSON.stringify({ type, properties })}\n\n`);
  event("message.updated", {
    info: {
      sessionID: "session",
      id: "message",
      role: "assistant",
      providerID: "own-account",
      modelID: "model",
    },
  });
  await expect
    .poll(() =>
      notifications.some(
        (n) => n.method === "session/model/updated" && n.params["model"] === "own-account/model",
      ),
    )
    .toBe(true);
  event("message.part.updated", {
    part: { sessionID: "session", messageID: "message", id: "part", type: "text", text: "Hi" },
  });
  event("message.part.delta", {
    sessionID: "session",
    messageID: "message",
    partID: "part",
    field: "text",
    delta: " there",
  });
  event("permission.asked", {
    sessionID: "other-session",
    id: "ignore",
    permission: "bash",
    patterns: ["echo ignored"],
  });
  event("permission.asked", {
    sessionID: "session",
    id: "permission",
    permission: "bash",
    patterns: ["echo test"],
  });
  await expect
    .poll(() => requests.find((r) => r.path === "/permission/permission/reply")?.body)
    .toEqual({ reply: "reject" });
  expect(input).toHaveBeenCalledOnce();
  expect(
    notifications.some((n) => n.params["item"] && object(n.params["item"])["text"] === "Hi there"),
  ).toBe(true);
  expect(requests.every((r) => r.auth?.startsWith("Basic "))).toBe(true);
  input.mockResolvedValueOnce({ decision: "accept", actionId: "always" });
  event("permission.asked", {
    sessionID: "session",
    id: "always",
    permission: "bash",
    patterns: ["echo test"],
  });
  await expect
    .poll(() => requests.find((r) => r.path === "/permission/always/reply")?.body)
    .toEqual({ reply: "always" });
  input.mockResolvedValueOnce({ decision: "decline" });
  event("question.asked", {
    sessionID: "session",
    id: "question",
    questions: [{ header: "Scope", question: "Where?", options: [] }],
  });
  await expect.poll(() => requests.some((r) => r.path === "/question/question/reject")).toBe(true);
  event("todo.updated", {
    sessionID: "session",
    todos: [{ content: "Verify", status: "in_progress" }],
  });
  event("message.part.updated", {
    part: {
      sessionID: "session",
      messageID: "message",
      id: "thinking",
      type: "reasoning",
      text: "Checking ",
    },
  });
  event("message.part.delta", {
    sessionID: "session",
    partID: "thinking",
    field: "text",
    delta: "results",
  });
  await expect
    .poll(() => notifications.some((n) => JSON.stringify(n.params).includes("Checking results")))
    .toBe(true);
  expect(notifications.some((n) => object(n.params["item"] ?? {})["type"] === "plan")).toBe(true);
  await provider.request("turn/interrupt");
  expect(requests.some((r) => r.path === "/session/session/abort")).toBe(true);
  expect(
    object(notifications.findLast((n) => n.method === "turn/completed")!.params["turn"])["status"],
  ).toBe("interrupted");
  await provider.request("command/execute", {
    ...turn,
    model: "own-account/model",
    name: "compact",
  });
  await expect
    .poll(
      () =>
        notifications.filter(
          (n) =>
            n.method === "item/completed" &&
            object(n.params["item"])["type"] === "contextCompaction",
        ).length,
    )
    .toBe(1);
  expect(requests.find((r) => r.path.endsWith("/summarize"))?.body).toEqual({
    providerID: "own-account",
    modelID: "model",
  });
  expect(requests.filter((r) => r.path.endsWith("/prompt_async"))).toHaveLength(1);
  expect(failures).toEqual([]);
});

it("maps Pi JSONL, preserves editor forms, and ignores a cancelled pending dialog", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-pi-adapter-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  vi.stubEnv("CONCORS_DATA_DIR", directory);
  const commands: Record<string, unknown>[] = [];
  let process: ChildProcessWithoutNullStreams;
  vi.mocked(launch).mockImplementation(() => {
    process = child();
    const current = process;
    current.stdin.on("data", (chunk) => {
      const command = object(JSON.parse(String(chunk)));
      commands.push(command);
      if (command["id"] && command["type"] !== "extension_ui_response")
        queueMicrotask(() =>
          current.stdout.push(
            JSON.stringify({
              type: "response",
              id: command["id"],
              success: true,
              data:
                command["type"] === "get_available_models"
                  ? { models: [{ provider: "own", id: "model", name: "My model" }] }
                  : {},
            }) + "\n",
          ),
        );
    });
    return process;
  });
  let rejectDialog: (error: Error) => void = () => undefined;
  const input = vi
    .fn()
    .mockResolvedValueOnce({ decision: "decline" })
    .mockResolvedValueOnce({ answers: { value: { answers: ["  preserve indentation\n"] } } })
    .mockResolvedValueOnce({ decision: "decline" })
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectDialog = reject;
        }),
    );
  const provider = new PiProvider(directory, input);
  const { notifications, failures } = observe(provider);
  await provider.initialize();
  expect(await provider.request("model/list")).toMatchObject({ data: [{ model: "own/model" }] });
  const first = object(await provider.request("thread/start"));
  await provider.request("turn/start", { ...turn, model: "own/model" });
  const event = (value: unknown) => process!.stdout.push(JSON.stringify(value) + "\n");
  event({ type: "message_start" });
  event({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Hello Pi" },
  });
  event({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "Hello Pi" }] },
  });
  event({
    type: "extension_ui_request",
    id: "first",
    method: "confirm",
    title: "Concors tool approval: read",
    message: "read",
  });
  await expect
    .poll(() => commands.find((c) => c["id"] === "first"))
    .toMatchObject({ type: "extension_ui_response", confirmed: false });
  event({
    type: "extension_ui_request",
    id: "editor",
    method: "editor",
    title: "Edit notes",
    prefill: "  initial notes\n",
  });
  await expect
    .poll(() => commands.find((c) => c["id"] === "editor"))
    .toMatchObject({ value: "  preserve indentation\n" });
  expect(input.mock.calls[1]?.[1]).toMatchObject({
    questions: [{ required: false, multiline: true, defaultValue: "  initial notes\n" }],
  });
  event({
    type: "extension_ui_request",
    id: "select",
    method: "select",
    title: "Choose target",
    options: ["One", "Two"],
  });
  await expect
    .poll(() => commands.find((c) => c["id"] === "select"))
    .toMatchObject({ cancelled: true });
  event({
    type: "extension_ui_request",
    id: "second",
    method: "confirm",
    title: "Read file?",
    message: "read",
  });
  await expect.poll(() => input.mock.calls.length).toBe(4);
  expect(input.mock.calls[3]?.[1]).toMatchObject({
    questions: [{ id: "confirm", allowOther: false, options: [{ label: "Yes" }, { label: "No" }] }],
  });
  await provider.request("turn/interrupt");
  rejectDialog(new Error("Turn interrupted"));
  await new Promise((resolve) => setImmediate(resolve));
  expect(
    object(notifications.findLast((n) => n.method === "turn/completed")!.params["turn"])["status"],
  ).toBe("interrupted");
  expect(
    notifications.some((n) => n.params["item"] && object(n.params["item"])["text"] === "Hello Pi"),
  ).toBe(true);
  expect(commands.some((c) => c["type"] === "set_model" && c["provider"] === "own")).toBe(true);
  await provider.request("thread/resume", { threadId: object(first["thread"])["id"] });
  expect(vi.mocked(launch).mock.calls.at(-1)![1]).toContain("--extension");
  await provider.request("command/execute", { ...turn, name: "compact", args: "Keep decisions" });
  await expect
    .poll(
      () =>
        notifications.filter(
          (n) =>
            n.method === "item/completed" &&
            object(n.params["item"])["type"] === "contextCompaction",
        ).length,
    )
    .toBe(1);
  expect(commands.find((c) => c["type"] === "compact")).toMatchObject({
    customInstructions: "Keep decisions",
  });
  expect(commands.filter((c) => c["type"] === "prompt")).toHaveLength(1);
  expect(failures).toEqual([]);
});

it("negotiates ACP controls, switches models, streams tools and respects native approval decisions", async () => {
  const process = child();
  const modes: string[] = [],
    models: string[] = [],
    prompts: unknown[] = [];
  const server = new AgentSideConnection(
    (client) => ({
      initialize: async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true, promptCapabilities: { image: false } },
        authMethods: [],
      }),
      authenticate: async () => ({}),
      newSession: async (params) => {
        expect(params.mcpServers).toEqual([]);
        await client.sessionUpdate({
          sessionId: "acp-session",
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [{ name: "compact", description: "Compact session" }],
          },
        });
        return {
          sessionId: "acp-session",
          models: {
            currentModelId: "model-a",
            availableModels: [
              { modelId: "model-a", name: "Model A" },
              { modelId: "model-b", name: "Model B" },
            ],
          },
          modes: {
            currentModeId: "ask",
            availableModes: [
              { id: "ask", name: "Ask" },
              { id: "plan", name: "Plan" },
            ],
          },
        };
      },
      setSessionMode: async (p) => {
        modes.push(p.modeId);
        return {};
      },
      unstable_setSessionModel: async (p) => {
        models.push(p.modelId);
        return {};
      },
      cancel: async () => {
        /* No prompt remains pending in this fixture. */
      },
      prompt: async (p) => {
        prompts.push(p.prompt);
        const outcome = await client.requestPermission({
          sessionId: p.sessionId,
          options: [
            { optionId: "yes", name: "Once", kind: "allow_once" },
            { optionId: "no", name: "No", kind: "reject_once" },
          ],
          toolCall: { toolCallId: "tool-1", title: "Read file", rawInput: { path: "README.md" } },
        });
        expect(outcome.outcome).toEqual({ outcome: "selected", optionId: "no" });
        await client.sessionUpdate({
          sessionId: p.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "read-without-input",
            title: "Read",
            kind: "read",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "Native file body" } }],
          },
        });
        await client.sessionUpdate({
          sessionId: p.sessionId,
          update: {
            sessionUpdate: "plan",
            entries: [{ content: "Verify ACP", priority: "medium", status: "in_progress" }],
          },
        });
        await client.sessionUpdate({
          sessionId: p.sessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Checking ACP results" },
          },
        });
        await client.sessionUpdate({
          sessionId: p.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Understood." },
          },
        });
        return { stopReason: "end_turn" };
      },
    }),
    ndJsonStream(
      Writable.toWeb(process.stdout as PassThrough),
      Readable.toWeb(process.stdin as PassThrough) as ReadableStream<Uint8Array>,
    ),
  );
  void server;
  const provider = new AcpProvider(
    tmpdir(),
    async () => ({ decision: "decline" }),
    {
      id: "fixture-acp",
      label: "Fixture",
      engine: "acp",
      command: ["fixture"],
      enabled: true,
      params: {
        mcpServers: [
          { name: "concors-schedules", type: "http", url: "http://127.0.0.1:10000/mcp" },
        ],
      },
    },
    () => process,
  );
  const { notifications } = observe(provider);
  await provider.initialize();
  await provider.request("thread/start");
  expect(await provider.request("session/controls")).toMatchObject({
    compact: true,
    currentMode: "ask",
    modes: [{ id: "ask" }, { id: "plan" }],
  });
  expect(await provider.request("model/list")).toMatchObject({
    data: [{ model: "model-a", supportsImages: false }, { model: "model-b" }],
  });
  await provider.request("turn/start", { ...turn, model: "model-b", nativeMode: "plan" });
  await expect
    .poll(() => notifications.filter((n) => n.method === "turn/completed").length)
    .toBe(1);
  expect(notifications.some((n) => object(n.params["item"] ?? {})["steps"])).toBe(true);
  expect(
    notifications.some((n) =>
      JSON.stringify(object(n.params["item"] ?? {})["summary"] ?? "").includes(
        "Checking ACP results",
      ),
    ),
  ).toBe(true);
  expect(models).toEqual(["model-b"]);
  expect(
    notifications.some((n) => object(n.params["item"] ?? {})["output"] === "Native file body"),
  ).toBe(true);
  expect(modes).toEqual(["plan"]);
  await provider.request("command/execute", { ...turn, name: "compact", args: "" });
  await expect
    .poll(() => notifications.filter((n) => n.method === "turn/completed").length)
    .toBe(2);
  expect(prompts.at(-1)).toEqual([{ type: "text", text: "/compact" }]);
});

it("waits for OMP readiness, negotiates v2, and uses RPC UI approvals instead of unattended mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-omp-adapter-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  vi.stubEnv("CONCORS_DATA_DIR", directory);
  const commands: Record<string, unknown>[] = [];
  const launcher: typeof launch = (_provider, args) => {
    expect(args).toContain("rpc-ui");
    expect(args).toContain("always-ask");
    expect(args).not.toContain("yolo");
    const process = child();
    process.stdin.on("data", (chunk) => {
      const command = object(JSON.parse(String(chunk)));
      commands.push(command);
      process.stdout.push(
        JSON.stringify({
          id: command["id"],
          type: "response",
          success: true,
          data: command["type"] === "negotiate_protocol" ? { protocolVersion: 2 } : {},
        }) + "\n",
      );
    });
    queueMicrotask(() =>
      process.stdout.push(
        JSON.stringify({
          type: "ready",
          supportedProtocolVersions: [1, 2],
          maxFrameBytes: 1048576,
          maxReassembledFrameBytes: 67108864,
        }) + "\n",
      ),
    );
    return process;
  };
  const provider = new PiProvider(
    directory,
    async () => ({ decision: "decline" }),
    launcher,
    "omp",
  );
  observe(provider);
  await provider.initialize();
  expect(commands.map((c) => c["type"])).toEqual([
    "negotiate_protocol",
    "get_state",
    "get_available_commands",
  ]);
});

it("recovers ACP turns with stable chunk identities instead of appending duplicate replay items", async () => {
  const process = child();
  new AgentSideConnection(
    (client) => ({
      initialize: async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
        authMethods: [],
      }),
      authenticate: async () => ({}),
      newSession: async () => ({ sessionId: "saved" }),
      cancel: async () => {
        /* No active prompt in this replay fixture. */
      },
      prompt: async () => ({ stopReason: "end_turn" as const }),
      loadSession: async (p) => {
        for (let i = 0; i < 2; i++) {
          await client.sessionUpdate({
            sessionId: p.sessionId,
            update: {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: "same prompt" },
            },
          });
          for (const text of ["Hello ", "again"])
            await client.sessionUpdate({
              sessionId: p.sessionId,
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
            });
        }
        return {};
      },
    }),
    ndJsonStream(
      Writable.toWeb(process.stdout as PassThrough),
      Readable.toWeb(process.stdin as PassThrough) as ReadableStream<Uint8Array>,
    ),
  );
  const provider = new AcpProvider(
    tmpdir(),
    async () => ({ decision: "decline" }),
    { id: "fixture-acp", label: "Fixture", engine: "acp", command: ["fixture"], enabled: true },
    () => process,
  );
  observe(provider);
  await provider.initialize();
  const first = await provider.request("thread/resume", { threadId: "saved" });
  const second = await provider.request("thread/resume", { threadId: "saved" });
  expect(second).toEqual(first);
  const turns = object(object(first)["thread"])["turns"] as {
    id: string;
    items: { text?: string }[];
  }[];
  expect(turns).toHaveLength(2);
  expect(turns[0]?.id).not.toBe(turns[1]?.id);
  expect(turns.map((t) => t.items.length)).toEqual([2, 2]);
  expect(turns.map((t) => t.items[1]?.text)).toEqual(["Hello again", "Hello again"]);
});
it("shows a Claude sub-agent's tool calls as steps of the call that started it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-claude-subagent-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, process.platform === "win32" ? "claude.cmd" : "claude"), "", {
    mode: 0o755,
  });
  vi.stubEnv("PATH", directory);
  let emit: (value: unknown) => void = () => undefined;
  const createQuery = vi.fn(() => {
    const messages = new PassThrough({ objectMode: true });
    emit = (value) => messages.write(value);
    return Object.assign(messages, {
      initializationResult: async () => ({
        models: [{ value: "default", displayName: "Default" }],
      }),
      getContextUsage: async () => ({ model: "claude-sonnet-5" }),
      setModel: async () => undefined,
      setPermissionMode: async () => undefined,
      close: () => {
        messages.end();
      },
    }) as unknown as Query;
  });
  const provider = new ClaudeProvider(directory, vi.fn(), createQuery);
  const { notifications } = observe(provider);
  await provider.initialize();
  await provider.request("thread/start");
  await provider.request("turn/start", turn);
  emit({
    type: "assistant",
    message: {
      id: "a",
      content: [
        {
          type: "tool_use",
          id: "task",
          name: "Agent",
          input: { description: "Survey the tests", subagent_type: "Explore", prompt: "Look" },
        },
      ],
    },
  });
  emit({
    type: "assistant",
    parent_tool_use_id: "task",
    message: {
      id: "nested",
      content: [
        { type: "text", text: "Reading the suite" },
        { type: "tool_use", id: "read", name: "Read", input: { file_path: "/repo/a.test.ts" } },
        { type: "tool_use", id: "grep", name: "Grep", input: { pattern: "describe\\(" } },
      ],
    },
  });
  emit({
    type: "user",
    parent_tool_use_id: "task",
    message: { content: [{ type: "tool_result", tool_use_id: "read", content: "ok" }] },
  });
  const items = () =>
    notifications.filter((n) => n.method.startsWith("item/")).map((n) => object(n.params["item"]));
  const latest = () =>
    items()
      .filter((item) => item["id"] === "task")
      .at(-1);
  await expect
    .poll(() => latest())
    .toMatchObject({
      type: "collabAgentToolCall",
      agentType: "Explore",
      prompt: "Survey the tests",
      status: "inProgress",
      activity: [
        { id: "read", title: "Read", text: "/repo/a.test.ts", status: "completed" },
        { id: "grep", title: "Grep", text: "describe\\(", status: "running" },
      ],
    });
  // Nothing the sub-agent did joins the main conversation as its own item.
  const ids = items().map((item) => item["id"]);
  expect(ids).not.toContain("read");
  expect(ids).not.toContain("grep");
  expect(items().some((item) => item["type"] === "subAgentActivity")).toBe(false);

  emit({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "task", content: "Found 12 tests" }] },
  });
  await expect.poll(() => latest()?.["status"]).toBe("completed");
  expect(latest()?.["activity"]).toHaveLength(2);
});

it("reports a Claude plan limit beside the turn so the chat can offer another account", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-claude-limit-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, process.platform === "win32" ? "claude.cmd" : "claude"), "", {
    mode: 0o755,
  });
  vi.stubEnv("PATH", directory);
  let emit: (value: unknown) => void = () => undefined;
  const createQuery = vi.fn(() => {
    const messages = new PassThrough({ objectMode: true });
    emit = (value) => messages.write(value);
    return Object.assign(messages, {
      initializationResult: async () => ({
        models: [{ value: "default", displayName: "Default" }],
      }),
      getContextUsage: async () => ({ model: "claude-sonnet-5" }),
      setModel: async () => undefined,
      setPermissionMode: async () => undefined,
      close: () => {
        messages.end();
      },
    }) as unknown as Query;
  });
  const provider = new ClaudeProvider(directory, vi.fn(), createQuery);
  const { notifications } = observe(provider);
  await provider.initialize();
  await provider.request("thread/start");
  await provider.request("turn/start", turn);
  const limits = () => notifications.filter((n) => n.method === "account/limitReached");

  // Approaching a limit is not reaching it.
  emit({
    type: "rate_limit_event",
    rate_limit_info: { status: "allowed_warning", resetsAt: 1_900_000_000, utilization: 0.9 },
  });
  emit({
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", resetsAt: 1_900_000_000 },
  });
  await expect.poll(() => limits()).toHaveLength(1);
  expect(limits()[0]?.params["resetsAt"]).toBe(new Date(1_900_000_000_000).toISOString());

  // Claude's own limit reply keeps the reset time the event gave.
  emit({
    type: "assistant",
    error: "rate_limit",
    message: { id: "limit", content: [{ type: "text", text: "You've hit your limit" }] },
  });
  await expect.poll(() => limits()).toHaveLength(2);
  expect(limits()[1]?.params["resetsAt"]).toBe(new Date(1_900_000_000_000).toISOString());
});
