import {
  AGENT_USAGE_CAPABILITY,
  parseClientMessage,
  applyWorkspaceOperation,
  WorkspaceOperationError,
  AgentInfoSchema,
  type DaemonMessage,
  type AgentOperation,
  type AgentItem,
  type AgentInfo,
  type TerminalInfo,
  type ProjectSetup,
} from "@concors/protocol";
import { MachineIconSchema, type Machine, type SshKey } from "@concors/api-client";
import type { WebSocketLike } from "@concors/daemon-client";
import { newRequestId } from "@concors/client-core";
import { demoResources } from "./resources";
import {
  demoAgent,
  demoItems,
  demoMachine,
  demoMe,
  demoPlanUsage,
  demoTerminal,
  demoWorkspace,
  ids,
} from "./fixtures";

interface Conversation {
  agent: AgentInfo;
  items: AgentItem[];
  timer?: ReturnType<typeof setInterval>;
}
interface TerminalState {
  session: TerminalInfo;
  sequence: number;
  output: string;
  owner: string | null;
}
/** In-memory fixture: all actions are simulated, including files, processes, machines and billing. */
export function createDemoServer() {
  const resources = demoResources();
  let workspace = structuredClone(demoWorkspace);
  const conversations = new Map<string, Conversation>([
    [ids.agent, { agent: structuredClone(demoAgent), items: structuredClone(demoItems) }],
  ]);
  const terminals = new Map<string, TerminalState>([
    [
      ids.terminal,
      {
        session: structuredClone(demoTerminal),
        sequence: 0,
        output:
          "\x1b[36mConcors demo terminal\x1b[0m\r\nCommands are simulated in this preview.\r\n\r\n~/concors $ ",
        owner: null,
      },
    ],
  ]);
  const setups = new Map<string, ProjectSetup>();
  const sockets = new Set<DemoSocket>();
  const replies = new Map<string, DaemonMessage>();
  const machines: Machine[] = [structuredClone(demoMachine)];
  let keys: SshKey[] = [];
  const broadcast = (message: DaemonMessage) => {
    for (const socket of sockets) socket.emit(message);
  };
  const snapshot = () => broadcast({ type: "workspace.snapshot", snapshot: workspace });
  const state = (conversation: Conversation) => {
    conversation.agent = {
      ...conversation.agent,
      revision: conversation.agent.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    broadcast({ type: "agent.state", agent: conversation.agent });
  };
  const complete = (conversation: Conversation) => {
    clearInterval(conversation.timer);
    conversation.agent = {
      ...conversation.agent,
      status: "done",
      pending: [],
      turnStartedAt: null,
      attention: {
        id: newRequestId(),
        kind: "done",
        createdAt: new Date().toISOString(),
        seen: false,
      },
    };
    state(conversation);
  };
  const findPane = (projectId: string, tabId: string, paneId: string) => {
    const project = workspace.projects.find((item) => item.id === projectId);
    const tab = project?.tabs.find((item) => item.id === tabId);
    const pane = tab?.nodes.find((item) => item.id === paneId);
    if (!project || !tab || !pane || pane.kind !== "pane") throw new Error("Pane not found");
    return { project, tab, pane };
  };
  const requestAgent = (operation: AgentOperation): Conversation => {
    if (operation.kind === "start") {
      const { project, tab, pane } = findPane(
        operation.projectId,
        operation.tabId,
        operation.paneId,
      );
      const prior = pane.sessionId ? conversations.get(pane.sessionId) : undefined;
      if (prior) return prior;
      if (project.version !== operation.expectedVersion || workspace.epoch !== operation.epoch)
        throw new Error("Workspace changed. Retry with its current version.");
      const id = newRequestId(),
        now = new Date().toISOString();
      const conversation: Conversation = {
        agent: AgentInfoSchema.parse({
          ...demoAgent,
          id,
          projectId: project.id,
          name: tab.name,
          directory: project.directory,
          threadId: "demo-thread-" + id,
          turnId: null,
          status: "idle",
          pending: [],
          attention: null,
          revision: 1,
          startedAt: now,
          updatedAt: now,
          turnStartedAt: null,
        }),
        items: [],
      };
      conversations.set(id, conversation);
      pane.sessionId = id;
      project.version++;
      workspace.revision++;
      snapshot();
      state(conversation);
      return conversation;
    }
    const conversation = conversations.get(operation.sessionId);
    if (!conversation) throw new Error("Agent not found");
    if (operation.kind === "respond") {
      if (!conversation.agent.pending.some((pending) => pending.id === operation.pendingId))
        throw new Error("Request is no longer pending");
      conversation.agent = {
        ...conversation.agent,
        pending: [],
        status: "done",
        attention: null,
        turnStartedAt: null,
      };
      state(conversation);
    }
    if (operation.kind === "interrupt") {
      for (const item of conversation.items)
        if (item.status === "running") {
          item.status = "interrupted";
          item.revision++;
          broadcast({ type: "agent.item", item });
        }
      complete(conversation);
    }
    if (operation.kind === "seen" && conversation.agent.attention?.id === operation.attentionId) {
      conversation.agent = {
        ...conversation.agent,
        attention: { ...conversation.agent.attention, seen: true },
      };
      state(conversation);
    }
    if (operation.kind === "configure") {
      if (operation.expectedRevision !== conversation.agent.revision)
        throw new Error("Agent settings changed. Retry.");
      conversation.agent = { ...conversation.agent, settings: operation.settings };
      state(conversation);
    }
    if (operation.kind === "send") {
      if (["working", "needs_input", "starting"].includes(conversation.agent.status))
        throw new Error("Agent is busy; queue a follow-up.");
      const turnId = newRequestId();
      const user: AgentItem = {
        id: newRequestId(),
        sessionId: conversation.agent.id,
        turnId,
        position: conversation.items.length,
        revision: 0,
        kind: "user",
        title: "You",
        text:
          operation.text +
          (operation.attachments?.length
            ? "\n\nAttached: " + operation.attachments.map((file) => file.name).join(", ")
            : ""),
        detail: "",
        status: "completed",
        createdAt: new Date().toISOString(),
      };
      conversation.items.push(user);
      broadcast({ type: "agent.item", item: user });
      if (/ask (me )?a question/i.test(operation.text)) {
        const pendingId = newRequestId();
        conversation.agent = {
          ...conversation.agent,
          status: "needs_input",
          turnId,
          pending: [
            {
              id: pendingId,
              turnId,
              kind: "questions",
              title: "Choose a test target",
              summary: "This is a simulated agent question.",
              detail: "",
              decisions: [],
              questions: [
                {
                  id: "platform",
                  header: "Platform",
                  question: "Which platform should I verify?",
                  isSecret: false,
                  options: [
                    { label: "iOS", description: "Verify iPhone" },
                    { label: "Android", description: "Verify Android" },
                  ],
                },
              ],
            },
          ],
          attention: {
            id: pendingId,
            kind: "needs_input",
            createdAt: new Date().toISOString(),
            seen: false,
          },
        };
        state(conversation);
        return conversation;
      }
      const reply: AgentItem = {
        ...user,
        id: newRequestId(),
        position: conversation.items.length,
        kind: "assistant",
        title: "Codex",
        text: "",
        status: "running",
      };
      conversation.items.push(reply);
      conversation.agent = {
        ...conversation.agent,
        status: "working",
        turnId,
        pending: [],
        attention: null,
        turnStartedAt: new Date().toISOString(),
      };
      state(conversation);
      const text =
        "This is a simulated response. Your message traveled through the shared Concors protocol. Connect a real machine to run coding agents and see their actual output here.";
      let offset = 0;
      conversation.timer = setInterval(() => {
        offset += 16;
        reply.text = text.slice(0, offset);
        reply.revision++;
        reply.status = offset >= text.length ? "completed" : "running";
        broadcast({ type: "agent.item", item: { ...reply } });
        if (reply.status === "completed") complete(conversation);
      }, 110);
    }
    return conversation;
  };
  class DemoSocket implements WebSocketLike {
    readyState = 0;
    private listeners = new Map<
      string,
      ((event: { data: unknown; code: number; reason: string }) => void)[]
    >();
    private viewer = newRequestId();
    private attached = new Set<string>();
    constructor() {
      sockets.add(this);
      queueMicrotask(() => {
        if (this.readyState !== 3) {
          this.readyState = 1;
          this.dispatch("open");
        }
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
      for (const terminal of terminals.values())
        if (terminal.owner === this.viewer) terminal.owner = null;
      this.dispatch("close");
    }
    send(raw: string) {
      const parsed = parseClientMessage(raw);
      if (!parsed.success || this.readyState !== 1) return;
      const message = parsed.data;
      queueMicrotask(() => {
        if (this.readyState !== 1) return;
        const key =
          "requestId" in message
            ? message.requestId
            : "commandId" in message
              ? message.commandId
              : null;
        const cached = key ? replies.get(key) : undefined;
        if (cached) {
          this.emit(cached);
          return;
        }
        const reply = (result: DaemonMessage) => {
          if (key) {
            replies.set(key, result);
            if (replies.size > 256) replies.delete(replies.keys().next().value ?? "");
          }
          this.emit(result);
        };
        try {
          switch (message.type) {
            case "client.hello":
              this.emit({
                type: "daemon.ready",
                protocolVersion: "v1",
                daemonVersion: "0.1.0",
                status: "ready",
                capabilities: [
                  "machine-resources",
                  "workspace",
                  "terminal",
                  "agents",
                  "agent-chat",
                  "agent-composer",
                  "agent-attention",
                  "terminal-recovery",
                  "directional-pane-split",
                  "workspace-pane-rearrangement",
                  "folder-workspaces",
                  AGENT_USAGE_CAPABILITY,
                ],
              });
              break;
            case "workspace.subscribe":
              this.emit({ type: "workspace.snapshot", snapshot: workspace });
              this.emit({
                type: "agent.list",
                agents: [...conversations.values()].map((entry) => entry.agent),
              });
              this.emit({ type: "project.setups", setups: [...setups.values()] });
              for (const terminal of terminals.values())
                this.emit({ type: "terminal.state", session: terminal.session });
              break;
            case "resource.request":
              reply(resources(message));
              break;
            case "workspace.command":
              if (message.epoch !== workspace.epoch)
                throw new Error("Workspace was reset. Refresh before retrying.");
              workspace = applyWorkspaceOperation(workspace, message.operation);
              snapshot();
              reply({
                type: "workspace.result",
                commandId: message.commandId,
                outcome: { status: "accepted", revision: workspace.revision },
              });
              break;
            case "agent.request": {
              const conversation = requestAgent(message.operation);
              const before =
                message.operation.kind === "read" ? message.operation.before : undefined;
              const after = message.operation.kind === "read" ? message.operation.after : undefined;
              const matching = conversation.items.filter(
                (item) =>
                  (before === undefined || item.position < before) &&
                  (after === undefined || item.position > after),
              );
              const items = after === undefined ? matching.slice(-80) : matching.slice(0, 80);
              reply({
                type: "agent.result",
                requestId: message.requestId,
                outcome: {
                  status: "ok",
                  conversation: {
                    agent: conversation.agent,
                    items,
                    hasMore: conversation.items.some(
                      (item) => item.position < (items[0]?.position ?? 0),
                    ),
                    hasNewer: conversation.items.some(
                      (item) => item.position > (items.at(-1)?.position ?? Infinity),
                    ),
                  },
                  ...(message.operation.kind === "usage" ? { usage: demoPlanUsage() } : {}),
                },
              });
              break;
            }
            case "terminal.request": {
              const op = message.operation;
              if (op.kind === "list") {
                reply({
                  type: "terminal.result",
                  requestId: message.requestId,
                  outcome: {
                    status: "ok",
                    sessions: [...terminals.values()].map((terminal) => terminal.session),
                  },
                });
                break;
              }
              let terminal: TerminalState | undefined;
              if (op.kind === "start") {
                const { project, pane } = findPane(op.projectId, op.tabId, op.paneId);
                terminal = pane.sessionId ? terminals.get(pane.sessionId) : undefined;
                if (!terminal || terminal.session.status !== "running") {
                  if (
                    workspace.epoch !== op.epoch ||
                    project.version !== op.expectedVersion ||
                    pane.profile === "chat"
                  )
                    throw new Error("Pane changed. Refresh and retry.");
                  const id = newRequestId();
                  terminal = {
                    session: {
                      ...demoTerminal,
                      id,
                      projectId: project.id,
                      directory: project.directory,
                      profile: pane.profile,
                      cols: op.cols,
                      rows: op.rows,
                      startedAt: new Date().toISOString(),
                    },
                    sequence: 0,
                    output: "Concors demo · Commands are simulated.\r\n$ ",
                    owner: null,
                  };
                  terminals.set(id, terminal);
                  pane.sessionId = id;
                  project.version++;
                  workspace.revision++;
                  snapshot();
                }
              } else terminal = terminals.get(op.sessionId);
              if (!terminal) throw new Error("Terminal not found");
              const id = terminal.session.id;
              if (op.kind === "attach") {
                this.attached.add(id);
                this.emit({
                  type: "terminal.snapshot",
                  session: terminal.session,
                  sequence: terminal.sequence,
                  data: terminal.output,
                  ownerId: terminal.owner,
                  viewerId: this.viewer,
                });
              }
              if (op.kind === "claim" || op.kind === "resize") {
                if (op.kind === "claim" && (!op.ifUnowned || terminal.owner === null))
                  terminal.owner = this.viewer;
                if (terminal.owner === this.viewer)
                  terminal.session = { ...terminal.session, cols: op.cols, rows: op.rows };
                broadcast({
                  type: "terminal.owner",
                  sessionId: id,
                  ownerId: terminal.owner,
                  cols: terminal.session.cols,
                  rows: terminal.session.rows,
                });
              }
              if (op.kind === "detach") {
                this.attached.delete(id);
                if (terminal.owner === this.viewer) terminal.owner = null;
              }
              if (op.kind === "stop") {
                terminal.session = { ...terminal.session, status: "exited", exitCode: 0 };
                broadcast({ type: "terminal.state", session: terminal.session });
              }
              reply({
                type: "terminal.result",
                requestId: message.requestId,
                outcome: { status: "ok", sessions: [terminal.session] },
              });
              break;
            }
            case "terminal.input": {
              const terminal = terminals.get(message.sessionId);
              if (
                !terminal ||
                terminal.owner !== this.viewer ||
                terminal.session.status !== "running" ||
                !this.attached.has(message.sessionId)
              )
                return;
              const data = message.data.replace(
                /\r/g,
                "\r\n[demo: command received]\r\n~/concors $ ",
              );
              terminal.output = (terminal.output + data).slice(-32000);
              broadcast({
                type: "terminal.output",
                sessionId: terminal.session.id,
                sequence: ++terminal.sequence,
                data,
              });
              break;
            }
            case "project.request": {
              const op = message.operation;
              if (op.kind === "browse") {
                if (op.epoch !== workspace.epoch) throw new Error("Workspace was reset");
                const directory =
                  (op.directory || "~").replace(/^~/, "/home/demo").replace(/\/$/, "") || "/";
                reply({
                  type: "project.result",
                  requestId: message.requestId,
                  outcome: {
                    status: "listed",
                    directory,
                    parent:
                      directory === "/"
                        ? null
                        : directory.slice(0, directory.lastIndexOf("/")) || "/",
                    home: "/home/demo",
                    entries:
                      directory === "/home/demo"
                        ? [{ name: "concors", directory: "/home/demo/concors" }]
                        : [],
                    truncated: false,
                  },
                });
                break;
              }
              if (op.kind === "cancel") {
                const setup = setups.get(op.id);
                if (setup) setup.status = "cancelled";
              } else {
                if (op.epoch !== workspace.epoch) throw new Error("Workspace was reset");
                const setup: ProjectSetup = {
                  id: op.id,
                  name:
                    op.kind === "workspace"
                      ? "New workspace"
                      : op.directory.split("/").filter(Boolean).at(-1) || "Workspace",
                  directory:
                    op.kind === "workspace" ? `/home/demo/workspaces/${op.id}` : op.directory,
                  repository: op.kind === "workspace" ? "" : op.repository,
                  mode: op.kind === "workspace" ? "create" : op.mode,
                  status: "working",
                  progress: "Simulating project setup. No files are created.",
                };
                setups.set(op.id, setup);
                setTimeout(() => {
                  if (setup.status !== "working") return;
                  try {
                    workspace = applyWorkspaceOperation(workspace, {
                      kind: "project.add",
                      projectId: op.id,
                      name: setup.name,
                      directory: setup.directory,
                    });
                    setup.status = "done";
                    setup.progress = "Demo project ready. No real files were changed.";
                    snapshot();
                  } catch (cause) {
                    setup.status = "failed";
                    setup.progress = cause instanceof Error ? cause.message : "Setup failed";
                  }
                  broadcast({ type: "project.setups", setups: [...setups.values()] });
                }, 300);
              }
              broadcast({ type: "project.setups", setups: [...setups.values()] });
              reply({
                type: "project.result",
                requestId: message.requestId,
                outcome: { status: "ok" },
              });
              break;
            }
          }
        } catch (cause) {
          const text = cause instanceof Error ? cause.message : "Demo request failed";
          if (message.type === "workspace.command")
            reply({
              type: "workspace.result",
              commandId: message.commandId,
              outcome: {
                status: "rejected",
                code: cause instanceof WorkspaceOperationError ? cause.code : "INVALID_OPERATION",
                message: text,
              },
            });
          else if (message.type === "agent.request")
            reply({
              type: "agent.result",
              requestId: message.requestId,
              outcome: { status: "error", message: text },
            });
          else if (message.type === "terminal.request")
            reply({
              type: "terminal.result",
              requestId: message.requestId,
              outcome: { status: "error", message: text },
            });
          else if (message.type === "project.request")
            reply({
              type: "project.result",
              requestId: message.requestId,
              outcome: { status: "error", message: text },
            });
        }
      });
    }
  }
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return {
    socket: () => new DemoSocket(),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const path = url.pathname,
        method = init?.method ?? "GET";
      const raw: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      if (path === "/api/auth/sign-in/email")
        return response({ user: demoMe.user, token: "demo-session-token" });
      if (path === "/api/v1/me") return response(demoMe);
      if (path === "/api/v1/github/")
        return response({
          configured: false,
          connected: false,
          login: null,
          updatedAt: null,
          manageUrl: null,
        });
      if (path === "/api/v1/organizations")
        return response({
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
        });
      if (path === "/api/v1/mobile/capabilities")
        return response({
          version: 1,
          remoteAccess: true,
          pushNotifications: false,
          accountDeletion: false,
        });
      if (path === "/api/auth/sign-out" || path === "/api/auth/organization/set-active")
        return response({});
      if (path === "/api/v1/machines/catalog")
        return response({
          regions: [{ id: "US-EAST-VA", location: "Virginia (demo)", countryCode: "US" }],
          sizes: [
            {
              id: "medium",
              label: "Medium",
              vcpus: 4,
              ramGb: 8,
              diskGb: 80,
              monthlyPrice: null,
            },
          ],
          image: "Ubuntu · simulated",
          sshUser: "ubuntu",
        });
      if (path === "/api/v1/machines") {
        if (method === "POST") {
          const machine = {
            ...demoMachine,
            id: newRequestId(),
            name: String(body.name),
            region: String(body.region),
            size: String(body.size),
            status: "provisioning" as const,
            statusMessage:
              "Simulated provisioning. Use the original demo machine for workspace testing.",
          };
          machines.push(machine);
          return response({ machine });
        }
        return response({
          machines: machines.map((machine) => ({
            ...machine,
            agentSeenAt: new Date().toISOString(),
          })),
        });
      }
      const machineId = path.match(/^\/api\/v1\/machines\/([^/]+)(\/resume|\/icon)?$/);
      if (machineId) {
        const machine = machines.find((item) => item.id === machineId[1]);
        if (!machine) return response({ message: "Demo machine not found" }, 404);
        if (method === "DELETE") {
          machine.cancelledAt = new Date().toISOString();
          machine.paidUntil = "2099-01-01T00:00:00.000Z";
        }
        if (machineId[2] === "/resume") machine.cancelledAt = null;
        if (method === "PATCH") {
          if (machineId[2] === "/icon") machine.icon = MachineIconSchema.parse(body.icon);
          else machine.name = String(body.name);
        }
        return response({ machine });
      }
      if (path === "/api/v1/billing")
        return response({
          configured: false,
          hasPaymentMethod: false,
          card: null,
          paymentFailedAt: null,
          prices: [],
        });
      if (path === "/api/v1/billing/invoices") return response({ invoices: [] });
      if (path === "/api/v1/ssh-keys") {
        if (method === "POST") {
          const sshKey: SshKey = {
            id: newRequestId(),
            organizationId: "demo-org",
            createdByUserId: "demo-user",
            name: String(body.name),
            type: "ssh-ed25519",
            publicKey: String(body.publicKey),
            fingerprint: "SHA256:simulated-key",
            createdAt: new Date().toISOString(),
          };
          keys.push(sshKey);
          return response({ sshKey });
        }
        return response({ sshKeys: keys });
      }
      if (method === "DELETE" && path.startsWith("/api/v1/ssh-keys/")) {
        keys = keys.filter((key) => key.id !== path.split("/").at(-1));
        return response({});
      }
      return response({ message: "Not available in demo mode" }, 404);
    }) as typeof fetch,
  };
}
