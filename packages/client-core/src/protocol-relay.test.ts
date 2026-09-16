import { describe, expect, it, vi } from "vitest";
import { createProtocolRelay, type RelayConnection } from "./protocol-relay.ts";
import type { DaemonMessage } from "@concors/protocol";

const id = "11111111-1111-4111-8111-111111111111";
const hello = {
  type: "client.hello",
  protocolVersion: "v1",
  client: { kind: "mobile", name: "ui", version: "0.1.0" },
};
function setup() {
  const off = vi.fn();
  const connection: RelayConnection = {
    state: {
      status: "ready",
      daemon: { protocolVersion: "v1", daemonVersion: "1", status: "ready" },
    },
    workspace: {
      schemaVersion: 1,
      machineId: id,
      epoch: id,
      revision: 1,
      projects: [],
      selection: null,
    },
    terminals: [],
    subscribeWorkspace: vi.fn(() => off),
    onAgent: vi.fn(() => off),
    onTerminal: vi.fn(() => off),
    subscribeProjectSetups: vi.fn(() => off),
    subscribeHostUsage: vi.fn(() => off),
    executeWorkspace: vi.fn<RelayConnection["executeWorkspace"]>(async (command) => ({
      type: "workspace.result",
      commandId: command.commandId,
      outcome: { status: "rejected", code: "INVALID_OPERATION", message: "fixture" },
    })),
    requestAgent: vi.fn<RelayConnection["requestAgent"]>(async (_, requestId) => ({
      type: "agent.result",
      requestId,
      outcome: { status: "error", message: "fixture" },
    })),
    requestProject: vi.fn<RelayConnection["requestProject"]>(async (_, requestId) => ({
      type: "project.result",
      requestId,
      outcome: { status: "error", message: "fixture" },
    })),
    requestThemes: vi.fn<RelayConnection["requestThemes"]>(async (requestId) => ({
      type: "theme.result",
      requestId,
      catalog: { directory: "/themes", themes: [], issues: [] },
    })),
    requestProvider: vi.fn<RelayConnection["requestProvider"]>(async (_, requestId) => ({
      type: "provider.result",
      requestId,
      outcome: { status: "error", message: "fixture" },
    })),
    requestFile: vi.fn<RelayConnection["requestFile"]>(async (_, requestId) => ({
      type: "file.result",
      requestId,
      outcome: { status: "error", message: "fixture" },
    })),
    requestTerminal: vi.fn<RelayConnection["requestTerminal"]>(async (_, requestId) => ({
      type: "terminal.result",
      requestId,
      outcome: { status: "ok", sessions: [] },
    })),
    sendTerminalInput: vi.fn(),
    requestResource: vi.fn<RelayConnection["requestResource"]>(async (_, requestId) => ({
      type: "resource.result",
      requestId,
      outcome: { status: "error", message: "fixture" },
    })),
  };
  const messages: DaemonMessage[] = [];
  const relay = createProtocolRelay(connection, (message) => messages.push(message));
  return { connection, messages, relay, off };
}
describe("offline UI protocol relay", () => {
  it("relays resource requests without changing process identities", async () => {
    const { connection, relay, messages } = setup();
    await relay.receive(hello);
    const operation = { kind: "stop", id: "123:456" } as const;
    await relay.receive({ type: "resource.request", requestId: id, operation });
    expect(connection.requestResource).toHaveBeenCalledWith(operation, id);
    expect(messages.at(-1)?.type).toBe("resource.result");
  });
  it("relays opt-in resource usage and detaches on disposal", async () => {
    const { connection, relay, messages, off } = setup();
    await relay.receive(hello);
    expect(connection.subscribeHostUsage).not.toHaveBeenCalled();
    await relay.receive({ type: "host.subscribe", enabled: true });
    await relay.receive({ type: "host.subscribe", enabled: true });
    expect(connection.subscribeHostUsage).toHaveBeenCalledOnce();
    const listener = vi.mocked(connection.subscribeHostUsage).mock.calls[0]![0];
    listener(null);
    expect(messages.at(-1)).toEqual({ type: "host.usage", usage: null });
    await relay.receive({ type: "host.subscribe", enabled: false });
    expect(off).toHaveBeenCalledOnce();
    await relay.receive({ type: "host.subscribe", enabled: true });
    relay.dispose();
    expect(off).toHaveBeenCalledTimes(6);
    const count = messages.length;
    listener(null);
    expect(messages).toHaveLength(count);
  });
  it("requires a valid handshake and refuses unknown messages", async () => {
    const { relay } = setup();
    await expect(relay.receive({ type: "workspace.subscribe" })).rejects.toThrow("handshake");
    await expect(relay.receive({ type: "fetch", url: "https://evil.test" })).rejects.toThrow(
      "Invalid",
    );
    await relay.receive(hello);
    await relay.receive(hello);
    relay.dispose();
  });
  it("forwards the exact request ID and validated operation for safe retries", async () => {
    const { connection, relay, messages } = setup();
    await relay.receive(hello);
    // Use a terminal request to exercise correlation without inventing a new wire contract.
    await relay.receive({
      type: "terminal.request",
      requestId: id,
      operation: { kind: "attach", sessionId: id },
    });
    expect(connection.requestTerminal).toHaveBeenCalledWith({ kind: "attach", sessionId: id }, id);
    expect(messages.at(-1)).toMatchObject({ type: "terminal.result", requestId: id });
    relay.dispose();
  });
  it("relays theme catalogs with the original request ID", async () => {
    const { connection, relay, messages } = setup();
    await relay.receive(hello);
    await relay.receive({ type: "theme.request", requestId: id });
    expect(connection.requestThemes).toHaveBeenCalledWith(id);
    expect(messages.at(-1)).toMatchObject({
      type: "theme.result",
      requestId: id,
      catalog: { directory: "/themes" },
    });
    relay.dispose();
  });
  it("detaches subscribed terminals on disposal, never stops them, and drops stale input", async () => {
    const { connection, relay, off } = setup();
    await relay.receive(hello);
    await expect(
      relay.receive({ type: "terminal.input", sessionId: id, data: "ls" }),
    ).rejects.toThrow("Attach");
    await relay.receive({
      type: "terminal.request",
      requestId: id,
      operation: { kind: "attach", sessionId: id },
    });
    await relay.receive({ type: "terminal.input", sessionId: id, data: "ls" });
    expect(connection.sendTerminalInput).toHaveBeenCalledOnce();
    relay.dispose();
    relay.dispose();
    expect(off).toHaveBeenCalledTimes(4);
    expect(connection.requestTerminal).toHaveBeenLastCalledWith(
      { kind: "detach", sessionId: id },
      expect.any(String),
    );
    await relay.receive({ type: "terminal.input", sessionId: id, data: "danger" });
    expect(connection.sendTerminalInput).toHaveBeenCalledOnce();
  });
  it("relays validated file operations with their original IDs and drops results after disposal", async () => {
    const { connection, relay, messages } = setup();
    await relay.receive(hello);
    const operation = { kind: "read", projectId: id, epoch: id, path: "README.md" } as const;
    await relay.receive({ type: "file.request", requestId: id, operation });
    expect(connection.requestFile).toHaveBeenCalledWith(operation, id);
    expect(messages.at(-1)).toMatchObject({ type: "file.result", requestId: id });
    await expect(
      relay.receive({
        type: "file.request",
        requestId: id,
        operation: { kind: "delete", path: "/" },
      }),
    ).rejects.toThrow("Invalid");
    type Result = Awaited<ReturnType<RelayConnection["requestFile"]>>;
    let finish: ((result: Result) => void) | undefined;
    const pendingResult = new Promise<Result>((resolve) => {
      finish = resolve;
    });
    vi.mocked(connection.requestFile).mockReturnValueOnce(pendingResult);
    const pendingRequest = relay.receive({ type: "file.request", requestId: id, operation });
    const count = messages.length;
    relay.dispose();
    finish?.({
      type: "file.result",
      requestId: id,
      outcome: { status: "error", message: "late fixture result" },
    });
    await pendingRequest;
    await relay.receive({ type: "file.request", requestId: id, operation });
    expect(messages).toHaveLength(count);
    expect(connection.requestFile).toHaveBeenCalledTimes(2);
  });
});
