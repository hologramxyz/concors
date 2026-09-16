import {
  AgentInfoSchema,
  AgentItemSchema,
  TerminalInfoSchema,
  WorkspaceSnapshotSchema,
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
