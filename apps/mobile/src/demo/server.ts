import {
  parseClientMessage,
  type DaemonMessage,
  type AgentOperation,
  type AgentItem,
} from "@concors/protocol";
import type { WebSocketLike } from "@concors/daemon-client";
import {
  demoAgent,
  demoItems,
  demoMachine,
  demoMe,
  demoTerminal,
  demoWorkspace,
  ids,
} from "./fixtures";

/** In-process development fixture speaking the real protocol; it never executes commands. */
export function createDemoServer() {
  let agent = structuredClone(demoAgent);
  let items = structuredClone(demoItems);
  const workspace = structuredClone(demoWorkspace);
  let terminal = structuredClone(demoTerminal);
  let sequence = 0;
  let output =
    "\x1b[36mConcors demo terminal\x1b[0m\r\nCommands are simulated in this preview.\r\n\r\n~/concors $ ";
  const sockets = new Set<DemoSocket>();
  const broadcast = (message: DaemonMessage) => {
    for (const socket of sockets) socket.emit(message);
  };
  const state = () => {
    agent = { ...agent, revision: agent.revision + 1, updatedAt: new Date().toISOString() };
    broadcast({ type: "agent.state", agent });
  };
  const complete = () => {
    agent = { ...agent, status: "done", pending: [], turnStartedAt: null };
    state();
  };
  const requestAgent = (operation: AgentOperation) => {
    if (operation.kind === "respond") {
      agent = { ...agent, pending: [], status: "done", attention: null };
      state();
    }
    if (operation.kind === "interrupt") complete();
    if (operation.kind === "seen") {
      agent = { ...agent, attention: null };
      state();
    }
    if (operation.kind === "configure") {
      agent = { ...agent, settings: operation.settings };
      state();
    }
    if (operation.kind === "send") {
      const user: AgentItem = {
        id: `demo-${items.length}`,
        sessionId: ids.agent,
        turnId: "demo-turn",
        position: items.length,
        revision: 0,
        kind: "user",
        title: "You",
        text: operation.text,
        detail: "",
        status: "completed",
        createdAt: new Date().toISOString(),
      };
      const reply: AgentItem = {
        ...user,
        id: `demo-${items.length + 1}`,
        position: items.length + 1,
        kind: "assistant",
        title: "Codex",
        text: "",
        status: "running",
      };
      items = [...items, user, reply];
      agent = {
        ...agent,
        status: "working",
        pending: [],
        attention: null,
        turnStartedAt: new Date().toISOString(),
      };
      state();
      broadcast({ type: "agent.item", item: user });
      const text =
        "This is a simulated response. Your message traveled through the shared Concors protocol. Connect a real machine to run coding agents and see their actual output here.";
      let offset = 0;
      const timer = setInterval(() => {
        offset += 20;
        reply.text = text.slice(0, offset);
        reply.revision++;
        reply.status =
          offset >= text.length || agent.status !== "working" ? "completed" : "running";
        broadcast({ type: "agent.item", item: { ...reply } });
        if (reply.status === "completed") {
          clearInterval(timer);
          complete();
        }
      }, 80);
    }
  };
  class DemoSocket implements WebSocketLike {
    readyState = 0;
    private listeners = new Map<
      string,
      ((event: { data: unknown; code: number; reason: string }) => void)[]
    >();
    private viewer = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    constructor() {
      sockets.add(this);
      queueMicrotask(() => {
        if (this.readyState === 3) return;
        this.readyState = 1;
        this.dispatch("open");
      });
    }
    addEventListener(
      type: string,
      listener: (event: { data: unknown; code: number; reason: string }) => void,
    ) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    private dispatch(type: string, data?: unknown) {
      for (const listener of this.listeners.get(type) ?? [])
        listener({ data, code: 1000, reason: "Demo disconnected" });
    }
    emit(message: DaemonMessage) {
      if (this.readyState === 1) this.dispatch("message", JSON.stringify(message));
    }
    close() {
      this.readyState = 3;
      sockets.delete(this);
      this.dispatch("close");
    }
    send(raw: string) {
      const parsed = parseClientMessage(raw);
      if (!parsed.success || this.readyState !== 1) return;
      const message = parsed.data;
      queueMicrotask(() => {
        switch (message.type) {
          case "client.hello":
            this.emit({
              type: "daemon.ready",
              protocolVersion: "v1",
              daemonVersion: "0.1.0",
              status: "ready",
              capabilities: ["workspace", "terminal", "agents"],
            });
            break;
          case "workspace.subscribe":
            this.emit({ type: "workspace.snapshot", snapshot: workspace });
            this.emit({ type: "agent.list", agents: [agent] });
            break;
          case "workspace.command":
            this.emit({
              type: "workspace.result",
              commandId: message.commandId,
              outcome: {
                status: "rejected",
                code: "INVALID_OPERATION",
                message:
                  "Layout creation is available on connected machines. This demo uses a fixed workspace.",
              },
            });
            break;
          case "agent.request":
            requestAgent(message.operation);
            this.emit({
              type: "agent.result",
              requestId: message.requestId,
              outcome: { status: "ok", conversation: { agent, items, hasMore: false } },
            });
            break;
          case "terminal.request": {
            const op = message.operation;
            if (op.kind === "claim" || op.kind === "resize") {
              terminal = { ...terminal, cols: op.cols, rows: op.rows };
              this.emit({
                type: "terminal.owner",
                sessionId: terminal.id,
                ownerId: this.viewer,
                cols: op.cols,
                rows: op.rows,
              });
            }
            if (op.kind === "attach")
              this.emit({
                type: "terminal.snapshot",
                session: terminal,
                sequence,
                data: output,
                ownerId: this.viewer,
                viewerId: this.viewer,
              });
            if (op.kind === "stop") {
              terminal = { ...terminal, status: "exited", exitCode: 0 };
              broadcast({ type: "terminal.state", session: terminal });
            }
            this.emit({
              type: "terminal.result",
              requestId: message.requestId,
              outcome: { status: "ok", sessions: [terminal] },
            });
            break;
          }
          case "terminal.input": {
            const data = message.data.replace(
              /\r/g,
              "\r\n[demo: command received]\r\n~/concors $ ",
            );
            output = (output + data).slice(-32_000);
            broadcast({
              type: "terminal.output",
              sessionId: terminal.id,
              sequence: ++sequence,
              data,
            });
            break;
          }
          case "project.request":
            this.emit({
              type: "project.result",
              requestId: message.requestId,
              outcome: { status: "error", message: "Connect a real machine to create projects." },
            });
            break;
        }
      });
    }
  }
  return {
    socket: () => new DemoSocket(),
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const path = url.pathname;
      const body =
        path === "/api/auth/sign-in/email"
          ? { user: demoMe.user, token: "demo-session-token" }
          : path === "/api/v1/me"
            ? demoMe
            : path === "/api/v1/machines"
              ? { machines: [demoMachine] }
              : path === "/api/v1/organizations"
                ? {
                    organizations: [
                      {
                        id: "demo-org",
                        name: "Personal workspace",
                        slug: "demo",
                        logo: null,
                        isPersonal: true,
                        role: "owner",
                        createdAt: demoMe.user.createdAt,
                      },
                    ],
                  }
                : path === "/api/v1/mobile/capabilities"
                  ? {
                      version: 1,
                      remoteAccess: true,
                      pushNotifications: false,
                      accountDeletion: false,
                    }
                  : path === "/api/auth/sign-out"
                    ? {}
                    : null;
      return new Response(JSON.stringify(body ?? { message: "Not available in demo mode" }), {
        status: body ? 200 : 404,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  };
}
