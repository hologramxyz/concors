import {
  DEFAULT_TERMINAL_PROFILES,
  AgentInfoSchema,
  AgentItemSchema,
  TerminalInfoSchema,
  WorkspaceSnapshotSchema,
  type AgentInfo,
  type AgentPlanUsage,
} from "@concors/protocol";
import { MeSchema, MachineSchema } from "@concors/api-client";

export const ids = {
  machine: "11111111-1111-4111-8111-111111111111",
  epoch: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  tab: "44444444-4444-4444-8444-444444444444",
  pane: "55555555-5555-4555-8555-555555555555",
  agent: "66666666-6666-4666-8666-666666666666",
  terminal: "77777777-7777-4777-8777-777777777777",
  terminalPane: "88888888-8888-4888-8888-888888888888",
  split: "99999999-9999-4999-8999-999999999999",
  approval: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const date = new Date(Date.now() - 60_000).toISOString();
export const demoMe = MeSchema.parse({
  user: {
    id: "demo-user",
    name: "Alex Morgan",
    email: "demo@concors.dev",
    emailVerified: true,
    image: null,
    createdAt: date,
    updatedAt: date,
  },
  session: {
    id: "demo-session",
    expiresAt: "2099-01-01T00:00:00.000Z",
    activeOrganizationId: "demo-org",
  },
});
export const demoWorkspace = WorkspaceSnapshotSchema.parse({
  schemaVersion: 1,
  machineId: ids.machine,
  epoch: ids.epoch,
  revision: 1,
  selection: { projectId: ids.project, tabId: ids.tab },
  projects: [
    {
      id: ids.project,
      name: "Concors",
      directory: "/home/alex/concors",
      version: 1,
      tabs: [
        {
          id: ids.tab,
          name: "Mobile launch",
          root: ids.split,
          nodes: [
            {
              id: ids.split,
              kind: "split",
              axis: "horizontal",
              ratio: 0.5,
              first: ids.pane,
              second: ids.terminalPane,
            },
            { id: ids.pane, kind: "pane", profile: "chat", sessionId: ids.agent },
            { id: ids.terminalPane, kind: "pane", profile: "shell", sessionId: ids.terminal },
          ],
        },
      ],
    },
  ],
});
/** The demo agent's plan: a session window with room left, and a weekly one running low. */
export const demoPlanUsage = (now = Date.now()): AgentPlanUsage => ({
  provider: "codex",
  status: "available",
  planLabel: "Pro",
  message: null,
  windows: [
    {
      id: "five-hour",
      label: "Session",
      usedPercent: 28,
      resetsAt: new Date(now + 3 * 3_600_000).toISOString(),
    },
    {
      id: "weekly",
      label: "Weekly",
      usedPercent: 74,
      resetsAt: new Date(now + 4 * 86_400_000).toISOString(),
    },
  ],
  fetchedAt: now,
});
export const demoAgent = AgentInfoSchema.parse({
  id: ids.agent,
  projectId: ids.project,
  provider: "codex",
  name: "Mobile launch",
  directory: "/home/alex/concors",
  model: "demo-codex",
  settings: {
    model: "demo-codex",
    effort: "medium",
    mode: "default",
    planMode: false,
    serviceTier: null,
  },
  models: [
    {
      id: "demo-codex",
      label: "Codex",
      efforts: ["low", "medium", "high"],
      defaultEffort: "medium",
      serviceTiers: [{ id: "fast", label: "Fast", description: "Simulated priority service" }],
    },
  ],
  supportsPlan: true,
  context: { used: 12400, limit: 200000, total: 18200 },
  threadId: "demo-thread",
  turnId: "demo-turn",
  status: "needs_input",
  error: null,
  startedAt: date,
  turnStartedAt: date,
  updatedAt: date,
  revision: 1,
  pending: [
    {
      id: ids.approval,
      turnId: "demo-turn",
      kind: "approval",
      title: "Run the test suite?",
      summary: "The next step verifies the mobile client.",
      detail: "pnpm mobile:test",
      decisions: ["accept", "decline", "cancel"],
      questions: [],
    },
  ],
  attention: { id: ids.approval, kind: "needs_input", createdAt: date, seen: false },
  // Codex can fork; it also reports context usage, which leaving controls out implied.
  controls: { fork: true, contextUsage: true },
});
export const demoItems = [
  AgentItemSchema.parse({
    id: "demo-user-message",
    sessionId: ids.agent,
    turnId: "demo-turn",
    position: 0,
    revision: 0,
    kind: "user",
    title: "You",
    text: "Help me get the mobile client ready to test.",
    detail: "",
    status: "completed",
    createdAt: date,
  }),
  AgentItemSchema.parse({
    id: "demo-assistant-message",
    sessionId: ids.agent,
    turnId: "demo-turn",
    position: 1,
    revision: 0,
    kind: "assistant",
    title: "Codex",
    text: "The mobile workspace is connected. You can review my progress, respond to a request, or open the terminal—all from here.",
    detail: "",
    status: "completed",
    createdAt: date,
  }),
];
demoItems.push(
  ...[
    {
      kind: "tool",
      title: "Thinking",
      text: "Reuse the existing **Concors UI** and adapt navigation for a phone.",
      detail: "",
      presentation: { type: "thinking" },
    },
    {
      kind: "plan",
      title: "Mobile plan",
      text: "Bring the workspace to mobile.",
      detail: "",
      presentation: {
        type: "plan",
        steps: [
          { step: "Share chat, composer and tool rendering", status: "completed" },
          { step: "Add sidebar and tab/pane navigation", status: "completed" },
          { step: "Verify iPhone and Android interactions", status: "inProgress" },
        ],
      },
    },
    {
      kind: "tool",
      title: "exec_command",
      text: "pnpm mobile:test",
      detail: "Demo test runner\n18 checks passed. No commands were actually executed.",
      presentation: { type: "shell", command: "pnpm mobile:test", exitCode: 0 },
    },
    {
      kind: "tool",
      title: "apply_patch",
      text: "Update the mobile navigation",
      detail: "--- a/navigation.ts\n+++ b/navigation.ts\n- bottomTabs: true\n+ sidebar: true",
      presentation: {
        type: "files",
        files: [
          {
            path: "navigation.ts",
            diff: "--- a/navigation.ts\n+++ b/navigation.ts\n- bottomTabs: true\n+ sidebar: true",
          },
        ],
      },
    },
    {
      kind: "tool",
      title: "mcp.workspace.inspect",
      text: "Inspect workspace",
      detail: "Two panes found",
      presentation: {
        type: "mcp",
        input: '{"project":"Concors"}',
        output: '{"panes":2,"connected":true}',
      },
    },
    {
      kind: "tool",
      title: "Agent",
      text: "Review the mobile layout",
      detail: "Layout review complete",
      presentation: {
        type: "sub_agent",
        children: [
          {
            id: "demo-reviewer",
            status: "completed",
            message:
              "The composer stays at the bottom and the **sidebar** reveals projects, agents and processes.",
          },
        ],
      },
    },
    {
      kind: "assistant",
      title: "Codex",
      text: "The workspace now uses the same chat components as desktop.\n\n- Swipe right to open the sidebar.\n- Use the selector above to switch panes.\n- Attach a file, change the model controls, or try `ask me a question`.\n\n\u0060\u0060\u0060typescript\nconst workspace = { sidebar: true, bottomTabs: false };\n\u0060\u0060\u0060\n\nEverything in this preview is simulated.",
      detail: "",
    },
  ].map((item, index) =>
    AgentItemSchema.parse({
      sessionId: ids.agent,
      turnId: "demo-turn",
      id: `demo-rich-${index}`,
      position: index + 2,
      revision: 0,
      status: "completed",
      createdAt: date,
      ...item,
    }),
  ),
);
export const demoTerminal = TerminalInfoSchema.parse({
  id: ids.terminal,
  projectId: ids.project,
  profile: "shell",
  directory: "/home/alex/concors",
  status: "running",
  exitCode: null,
  error: null,
  startedAt: date,
  cols: 80,
  rows: 24,
});
export const demoMachine = MachineSchema.parse({
  id: ids.machine,
  organizationId: "demo-org",
  createdByUserId: "demo-user",
  name: "Development",
  region: "US-EAST-VA",
  size: "medium",
  serviceName: "demo",
  hostname: "demo.concors.invalid",
  agentSeenAt: new Date().toISOString(),
  orderId: null,
  status: "running",
  ovhState: "running",
  lastError: null,
  ipv4: null,
  ipv6: null,
  sshUser: "ubuntu",
  accessReadyAt: date,
  reinstallTaskId: null,
  monthlyPrice: null,
  paidUntil: null,
  cancelledAt: null,
  createdAt: date,
  updatedAt: date,
  deletedAt: null,
});

/**
 * Extra rows for the sidebar's workspace tree, only when the demo is opened with
 * `?demo-sidebar-tree`, so its specs and screenshots see every row state without changing the
 * demo everyone else gets: a second workspace with the same name in another folder, a pinned chat,
 * a closed one, one chat per status, and a terminal left running with its tab closed.
 */
export const SIDEBAR_TREE_FLAG = "demo-sidebar-tree";
const treeId = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const treeIds = {
  fork: treeId(1),
  forkTab: treeId(2),
  forkPane: treeId(3),
  forkAgent: treeId(4),
  working: treeId(10),
  workingTab: treeId(11),
  done: treeId(20),
  doneTab: treeId(21),
  failed: treeId(30),
  failedTab: treeId(31),
  pinned: treeId(40),
  pinnedTab: treeId(41),
  closed: treeId(50),
  background: treeId(60),
};
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const treeChat = (
  id: string,
  projectId: string,
  name: string,
  status: "working" | "done" | "idle",
  minutes: number,
  extra: Record<string, unknown> = {},
) =>
  AgentInfoSchema.parse({
    ...demoAgent,
    id,
    projectId,
    name,
    status,
    pending: [],
    // A finished turn nobody has looked at yet. The same number under another prefix, as an
    // attention ID is a UUID of its own.
    attention:
      status === "done"
        ? { id: id.replace(/^c/, "a"), kind: "done", createdAt: minutesAgo(minutes), seen: false }
        : null,
    turnId: `${id}-turn`,
    startedAt: minutesAgo(minutes + 5),
    turnStartedAt: minutesAgo(minutes),
    updatedAt: minutesAgo(minutes),
    ...extra,
  });
/** A tab holding one chat pane. */
const chatTab = (id: string, paneId: string, name: string, sessionId: string) => ({
  id,
  name,
  root: paneId,
  nodes: [{ id: paneId, kind: "pane", profile: "chat", sessionId }],
});
/** A question and its answer, so a chat opened from the tree has something to show. */
const treeItems = (agent: AgentInfo) =>
  [
    { kind: "user", title: "You", text: `${agent.name}: can you take this on?` },
    { kind: "assistant", title: "Codex", text: "On it. Everything in this preview is simulated." },
  ].map((item, position) =>
    AgentItemSchema.parse({
      ...item,
      id: `${agent.id}-item-${position}`,
      sessionId: agent.id,
      turnId: agent.turnId,
      position,
      revision: 0,
      detail: "",
      status: "completed",
      createdAt: agent.turnStartedAt,
    }),
  );
export function sidebarTreeDemo() {
  const [concors] = demoWorkspace.projects;
  if (!concors) throw new Error("The demo has no workspace");
  const workspace = WorkspaceSnapshotSchema.parse({
    ...demoWorkspace,
    projects: [
      {
        ...concors,
        tabs: [
          ...concors.tabs,
          chatTab(treeIds.workingTab, treeId(12), "Release notes", treeIds.working),
          chatTab(treeIds.doneTab, treeId(22), "Fix sign-in", treeIds.done),
          chatTab(treeIds.failedTab, treeId(32), "Flaky upload test", treeIds.failed),
          chatTab(treeIds.pinnedTab, treeId(42), "Roadmap", treeIds.pinned),
        ],
      },
      {
        id: treeIds.fork,
        // The same name in another folder: the sidebar tells them apart by the parent folder.
        name: "Concors",
        directory: "/home/alex/forks/concors",
        version: 1,
        tabs: [chatTab(treeIds.forkTab, treeIds.forkPane, "Try the new parser", treeIds.forkAgent)],
      },
    ],
  });
  const agents = [
    treeChat(treeIds.working, ids.project, "Release notes", "working", 1),
    treeChat(treeIds.done, ids.project, "Fix sign-in", "done", 12),
    // Working until the app is watching: a failure from before it opened counts as seen.
    treeChat(treeIds.failed, ids.project, "Flaky upload test", "working", 25),
    treeChat(treeIds.pinned, ids.project, "Roadmap", "idle", 180, { pinned: true }),
    // No tab shows it, so it is listed closed, muted, under its workspace.
    treeChat(treeIds.closed, ids.project, "Old onboarding copy", "idle", 60 * 26),
    treeChat(treeIds.forkAgent, treeIds.fork, "Try the new parser", "done", 40),
  ];
  const terminal = TerminalInfoSchema.parse({
    ...demoTerminal,
    id: treeIds.background,
    foregroundCommand: "pnpm dev",
    startedAt: minutesAgo(90),
  });
  return {
    workspace,
    chats: agents.map((agent) => ({ agent, items: treeItems(agent) })),
    terminals: [terminal],
    failing: treeIds.failed,
  };
}

/**
 * A terminal profile saved on the machine, only with `?demo-terminal-profile`, so the New tab
 * sheet's specs and screenshots show one after the built-in ones.
 */
export const TERMINAL_PROFILE_FLAG = "demo-terminal-profile";
export const demoTerminalProfiles = [
  ...DEFAULT_TERMINAL_PROFILES,
  {
    id: "d0000000-0000-4000-8000-000000000001",
    name: "Dev server",
    command: "pnpm",
    args: ["dev"],
    version: 1,
  },
];
