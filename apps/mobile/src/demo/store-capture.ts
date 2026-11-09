/** Fictional project content for native App Store captures; never used by the live account. */
import { AgentInfoSchema, AgentItemSchema, WorkspaceSnapshotSchema } from "@concors/protocol";
import { demoAgent, demoWorkspace, ids } from "./fixtures";

const captureId = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const captureDirectory = (name: string) => `/home/alex/${name.toLowerCase().replaceAll(" ", "-")}`;

export function storeCaptureDemo() {
  const date = "2026-11-09T09:41:00.000Z";
  const agent = AgentInfoSchema.parse({
    ...demoAgent,
    name: "Search improvements",
    directory: "/home/alex/orbit",
    pending: [
      {
        ...demoAgent.pending[0],
        title: "Run the test suite?",
        summary: "Verify search and keyboard navigation.",
        detail: "pnpm test",
      },
    ],
  });
  const item = (position: number, content: Record<string, unknown>) =>
    AgentItemSchema.parse({
      id: `store-item-${position}`,
      sessionId: ids.agent,
      turnId: agent.turnId,
      position,
      revision: 0,
      detail: "",
      status: "completed",
      createdAt: date,
      ...content,
    });
  const items = [
    item(0, { kind: "user", title: "You", text: "Add instant search to the project dashboard." }),
    item(1, {
      kind: "assistant",
      title: "Codex",
      text: "Search is ready for review.\n\nI added debounced queries, keyboard navigation, and clear empty states.",
    }),
    item(2, {
      kind: "plan",
      title: "Search improvements",
      text: "Make projects easier to find.",
      presentation: {
        type: "plan",
        steps: [
          { step: "Build the search component", status: "completed" },
          { step: "Add keyboard navigation", status: "completed" },
          { step: "Run the test suite", status: "inProgress" },
        ],
      },
    }),
    item(3, {
      kind: "tool",
      title: "apply_patch",
      text: "Add instant search",
      presentation: {
        type: "files",
        files: [
          {
            path: "src/components/Search.tsx",
            diff: "--- a/src/components/Search.tsx\n+++ b/src/components/Search.tsx\n+const query = useDebounce(search, 200);\n+const results = useProjectSearch(query);",
          },
        ],
      },
    }),
    item(4, {
      kind: "assistant",
      title: "Codex",
      text: "The changes are in place. May I run the tests before you review?",
    }),
  ];
  const tab = (id: string, paneId: string, name: string, sessionId: string, profile = "chat") => ({
    id,
    name,
    root: paneId,
    nodes: [{ id: paneId, kind: "pane", profile, sessionId }],
  });
  const extra = [
    {
      project: captureId(1),
      tab: captureId(2),
      pane: captureId(3),
      agent: captureId(4),
      name: "Atlas API",
      task: "API documentation",
    },
    {
      project: captureId(5),
      tab: captureId(6),
      pane: captureId(7),
      agent: captureId(8),
      name: "Studio",
      task: "Landing page",
    },
  ];
  const workspace = WorkspaceSnapshotSchema.parse({
    ...demoWorkspace,
    projects: [
      {
        id: ids.project,
        name: "Orbit",
        directory: "/home/alex/orbit",
        version: 1,
        tabs: [
          tab(ids.tab, ids.pane, "Search improvements", ids.agent),
          tab(captureId(10), ids.terminalPane, "Checks", ids.terminal, "shell"),
        ],
      },
      ...extra.map((row) => ({
        id: row.project,
        name: row.name,
        directory: captureDirectory(row.name),
        version: 1,
        tabs: [tab(row.tab, row.pane, row.task, row.agent)],
      })),
    ],
  });
  return {
    workspace,
    agent,
    items,
    chats: extra.map((row) => ({
      agent: AgentInfoSchema.parse({
        ...agent,
        id: row.agent,
        projectId: row.project,
        name: row.task,
        directory: captureDirectory(row.name),
        status: "done",
        pending: [],
        attention: null,
        turnId: null,
        turnStartedAt: null,
      }),
      items: [],
    })),
    terminalOutput:
      "\u001b[36m~/orbit\u001b[0m $ pnpm test\r\n\r\n\u001b[1m RUN \u001b[0m v5.0.0 /home/alex/orbit\r\n\r\n \u001b[32m✓\u001b[0m search.test.ts (12 tests)\r\n \u001b[32m✓\u001b[0m keyboard.test.ts (8 tests)\r\n \u001b[32m✓\u001b[0m projects.test.ts (16 tests)\r\n\r\n Test Files  \u001b[32m3 passed\u001b[0m (3)\r\n      Tests  \u001b[32m36 passed\u001b[0m (36)\r\n   Duration  1.42s\r\n\r\n\u001b[36m~/orbit\u001b[0m $ ",
  };
}
