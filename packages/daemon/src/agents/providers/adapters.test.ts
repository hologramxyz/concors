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
import { OpenCodeProvider } from "./opencode.ts";
import { PiProvider } from "./pi.ts";
import { launch } from "./launch.ts";
import { object, type ConversationProvider } from "./contract.ts";

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
      initializationResult: async () => ({}),
      supportedModels: async () => [{ value: "sonnet", displayName: "Sonnet" }],
      setModel: async () => undefined,
      setPermissionMode: async () => undefined,
      interrupt: interrupts,
      close: () => {
        messages.end();
      },
    }) as unknown as Query;
  });
  const input = vi.fn(async () => ({ decision: "decline" }));
  const provider = new ClaudeProvider(directory, input, createQuery);
  const { notifications, failures } = observe(provider);
  await provider.initialize();
  const session = object(await provider.request("thread/start"));
  await provider.request("turn/start", turn);
  expect(options!.permissionMode).toBe("default");
  expect(options!.allowDangerouslySkipPermissions).toBeUndefined();
  emit({ type: "stream_event", event: { type: "message_start", message: { id: "a" } } });
  emit({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
  });
  emit({ type: "assistant", message: { id: "a", content: [{ type: "text", text: "Hello" }] } });
  await expect
    .poll(() =>
      notifications.some(
        (n) => n.method === "item/completed" && object(n.params["item"])["text"] === "Hello",
      ),
    )
    .toBe(true);
  const decision = await options!.canUseTool!(
    "Bash",
    { command: "echo test" },
    { signal: new AbortController().signal, toolUseID: "tool", requestId: "request" },
  );
  expect(decision?.behavior).toBe("deny");
  expect(input).toHaveBeenCalledOnce();
  await provider.request("turn/interrupt");
  expect(interrupts).toHaveBeenCalledOnce();
  expect(object(notifications.at(-1)!.params["turn"])["status"]).toBe("interrupted");
  const threadId = object(session["thread"])["id"];
  await provider.request("thread/resume", { threadId });
  expect(options!.resume).toBe(threadId);
  expect(failures).toEqual([]);
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
  const input = vi.fn(async () => ({ decision: "decline" }));
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
  event("message.updated", { info: { sessionID: "session", id: "message", role: "assistant" } });
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
  await provider.request("turn/interrupt");
  expect(requests.some((r) => r.path === "/session/session/abort")).toBe(true);
  expect(object(notifications.at(-1)!.params["turn"])["status"]).toBe("interrupted");
  expect(failures).toEqual([]);
});

it("maps Pi JSONL, denies tool confirmation, and ignores a cancelled pending dialog", async () => {
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
    title: "Read file?",
    message: "read",
  });
  await expect
    .poll(() => commands.find((c) => c["id"] === "first"))
    .toMatchObject({ type: "extension_ui_response", confirmed: false });
  event({
    type: "extension_ui_request",
    id: "second",
    method: "confirm",
    title: "Read file?",
    message: "read",
  });
  await expect.poll(() => input.mock.calls.length).toBe(2);
  await provider.request("turn/interrupt");
  rejectDialog(new Error("Turn interrupted"));
  await new Promise((resolve) => setImmediate(resolve));
  expect(object(notifications.at(-1)!.params["turn"])["status"]).toBe("interrupted");
  expect(
    notifications.some((n) => n.params["item"] && object(n.params["item"])["text"] === "Hello Pi"),
  ).toBe(true);
  expect(commands.some((c) => c["type"] === "set_model" && c["provider"] === "own")).toBe(true);
  await provider.request("thread/resume", { threadId: object(first["thread"])["id"] });
  expect(vi.mocked(launch).mock.calls.at(-1)![1]).toContain("--extension");
  expect(failures).toEqual([]);
});
