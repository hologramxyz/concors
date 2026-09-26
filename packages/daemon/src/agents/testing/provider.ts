import type { AgentProviderId } from "@concors/protocol";
import type { AgentPlanUsage } from "@concors/protocol";
import type { AgentProvider, AgentProviderFactory } from "../manager.ts";

/** Deterministic provider used only by integration tests and the acceptance-test server. */
export class TestAgentProvider implements AgentProvider {
  static turns = 0;
  readonly listeners = new Set<(method: string, params: unknown) => void>();
  readonly onRequest: Parameters<AgentProviderFactory>[1];
  readonly requests: { method: string; params: unknown }[] = [];
  threadId = "fixture-thread";
  cwd = process.cwd();
  turnId = "";
  closed = false;
  readonly provider: AgentProviderId;
  constructor(onRequest: Parameters<AgentProviderFactory>[1], provider: AgentProviderId = "codex") {
    this.provider = provider;
    this.onRequest = onRequest;
  }
  async initialize(): Promise<void> {
    /* No handshake needed for this test fixture. */
  }
  onNotification(listener: (method: string, params: unknown) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onFailure(): void {
    /* Failures are modeled as turn events in this fixture. */
  }
  emit(method: string, params: Record<string, unknown>) {
    if (!this.closed)
      for (const listener of this.listeners)
        listener(method, { threadId: this.threadId, turnId: this.turnId, ...params });
  }
  async request(method: string, params: unknown = {}): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === "session/controls")
      return {
        importSessions: true,
        fork: true,
        rewind: ["conversation"],
        steer: true,
        compact: true,
        commands: [
          { name: "compact", description: "Summarize earlier context" },
          { name: "review", description: "Review a change", argumentHint: "<target>" },
        ],
      };
    if (method === "command/execute") {
      // Mirrors a native compaction: a turn whose only item is the compaction's running/result.
      this.turnId = `turn-${++TestAgentProvider.turns}`;
      const item = { id: `compact-${this.turnId}`, type: "contextCompaction" };
      this.emit("turn/started", { turn: { id: this.turnId, status: "inProgress", items: [] } });
      this.emit("item/started", { item: { ...item, status: "inProgress" } });
      setTimeout(() => {
        this.emit("item/completed", { item: { ...item, status: "completed" } });
        this.finish();
      }, 150);
      return { turn: { id: this.turnId, status: "inProgress", items: [] } };
    }
    if (method === "session/list") {
      const offset = Number((params as { cursor?: string }).cursor ?? 0);
      return {
        sessions: Array.from({ length: 125 }, (_, index) => ({
          id: index ? `external-thread-${index + 1}` : "external-thread",
          title: index ? `Older CLI session ${index + 1}` : "CLI session",
          directory: this.cwd,
          updatedAt: new Date(Date.UTC(2026, 8, 12) - index * 60_000).toISOString(),
        })).slice(offset, offset + 100),
        nextCursor: offset + 100 < 125 ? String(offset + 100) : null,
      };
    }
    if (method === "session/fork") return { thread: { id: "forked-thread", turns: [] } };
    if (method === "session/rewind" || method === "session/steer") return {};
    if (method === "collaborationMode/list")
      return { data: this.provider === "codex" ? [{ mode: "plan" }, { mode: "default" }] : [] };
    if (method === "model/list")
      return {
        data: [
          {
            model: this.provider === "codex" ? "fixture" : `fixture-${this.provider}`,
            displayName:
              this.provider === "codex" ? "Fixture model" : `Fixture ${this.provider} model`,
            serviceTiers: [
              {
                id: "fast",
                name: "Fast",
                description: "Faster responses; additional usage may apply.",
              },
            ],
            supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
            defaultReasoningEffort: "high",
          },
        ],
      };
    const input = params as Record<string, unknown>;
    if (method === "thread/resume" && typeof input["threadId"] === "string")
      this.threadId = input["threadId"];
    if (method === "thread/start" || method === "thread/resume")
      return {
        thread: {
          id: this.threadId,
          turns: this.threadId.startsWith("external-thread")
            ? [
                {
                  id: "native-turn",
                  status: "completed",
                  items: [
                    {
                      id: "native-user",
                      type: "userMessage",
                      content: [{ type: "text", text: "Saved CLI prompt" }],
                    },
                    { id: "native-assistant", type: "agentMessage", text: "Saved CLI response" },
                  ],
                },
              ]
            : [],
        },
        model: this.provider === "codex" ? "fixture" : `fixture-${this.provider}`,
      };
    if (method === "turn/interrupt") {
      this.finish("interrupted");
      return {};
    }
    if (method !== "turn/start") throw new Error(`Unexpected method: ${method}`);
    this.turnId = `turn-${++TestAgentProvider.turns}`;
    this.emit("turn/started", { turn: { id: this.turnId, status: "inProgress", items: [] } });
    const text = (input["input"] as { text: string }[])[0]?.text ?? "";
    if (text === "primitive-form") {
      void this.onRequest(
        "item/tool/requestUserInput",
        {
          threadId: this.threadId,
          turnId: this.turnId,
          questions: [
            {
              id: "checks",
              header: "Checks",
              question: "Which checks should run?",
              multiSelect: true,
              allowOther: true,
              options: [
                { label: "Unit tests", description: "Run the focused suite" },
                { label: "Type check", description: "Verify types" },
              ],
            },
            {
              id: "notes",
              header: "Notes",
              question: "Additional notes",
              required: false,
              multiline: true,
              defaultValue: "Keep the public API stable.",
              options: [],
            },
          ],
        },
        "primitive-form",
      )
        .then(() => this.finish())
        .catch(() => undefined);
    } else if (text === "primitive-plan") {
      void this.onRequest(
        "item/commandExecution/requestApproval",
        {
          threadId: this.threadId,
          turnId: this.turnId,
          approvalKind: "plan",
          plan: "## Implementation plan\n\nAdd regression coverage before changing the handler.",
          actions: [
            { id: "implement", label: "Approve plan", decision: "accept" },
            { id: "reject", label: "Request changes", decision: "decline" },
            { id: "cancel", label: "Cancel turn", decision: "cancel" },
          ],
        },
        "primitive-plan",
      )
        .then(() => this.finish())
        .catch(() => undefined);
    } else if (text === "primitive-read") {
      this.emit("item/completed", {
        item: {
          id: `read-${this.turnId}`,
          type: "fileRead",
          path: "src/app.ts",
          output: "export const previewWorks = true;",
        },
      });
      this.finish();
    } else if (text.includes("approve")) {
      this.emit("item/started", {
        item: {
          id: `tool-${this.turnId}`,
          type: "commandExecution",
          command: "echo test",
          status: "inProgress",
        },
      });
      void this.onRequest(
        "item/commandExecution/requestApproval",
        {
          threadId: this.threadId,
          turnId: this.turnId,
          itemId: `tool-${this.turnId}`,
          command: "echo test",
        },
        "approval-1",
      )
        .then((result) => {
          this.emit("item/completed", {
            item: {
              id: `tool-${this.turnId}`,
              type: "commandExecution",
              command: "echo test",
              aggregatedOutput: JSON.stringify(result),
              status: "completed",
            },
          });
          this.finish();
        })
        .catch(() => undefined);
    } else if (text.includes("question")) {
      void this.onRequest(
        "item/tool/requestUserInput",
        {
          threadId: this.threadId,
          turnId: this.turnId,
          itemId: "question",
          questions: [
            {
              id: "color",
              header: "Color",
              question: "Which color?",
              options: [{ label: "Blue", description: "Use blue" }],
            },
          ],
        },
        "question-1",
      )
        .then(() => this.finish())
        .catch(() => undefined);
    } else if (text.includes("fail")) this.finish("failed");
    else {
      if (text.includes("file-links")) {
        this.emit("item/completed", {
          item: {
            id: `files-link-${this.turnId}`,
            type: "agentMessage",
            text: "Read [the README](README.md) or [the code](src/main.ts#L2).",
          },
        });
      }
      if (text.includes("rich")) {
        this.emit("item/completed", {
          item: {
            id: `markdown-${this.turnId}`,
            type: "agentMessage",
            text: "## Preview\n\nA **formatted** response.\n\n```ts\nconst ready = true;\n```\n\n| Item | Status |\n| --- | --- |\n| Preview | Ready |",
          },
        });
        this.emit("turn/plan/updated", {
          plan: [
            { step: "Inspect the project", status: "completed" },
            { step: "Implement the change", status: "inProgress" },
          ],
        });
        this.emit("item/started", {
          item: {
            id: "thinking",
            type: "reasoning",
            summary: ["Checking the implementation"],
            content: [],
          },
        });
        this.emit("item/started", {
          item: {
            id: "shell",
            type: "commandExecution",
            command: "echo fixture",
            cwd: "/project",
            status: "inProgress",
          },
        });
        this.emit("item/commandExecution/outputDelta", {
          itemId: "shell",
          delta: "fixture output",
        });
        this.emit("item/completed", {
          item: {
            id: "files",
            type: "fileChange",
            changes: [{ path: "example.ts", diff: "-old line\n+new line" }],
          },
        });
        this.emit("item/started", {
          item: {
            id: "child",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            receiverThreadIds: ["child-thread"],
            agentsStates: { "child-thread": { status: "running", message: "Inspecting tests" } },
            prompt: "Check the test coverage",
          },
        });
        // The sub-agent's own steps arrive on its thread, as Codex reports them.
        this.emit("item/completed", {
          threadId: "child-thread",
          item: {
            id: "child-read",
            type: "commandExecution",
            command: "rg --files tests",
            status: "completed",
          },
        });
        this.emit("item/started", {
          threadId: "child-thread",
          item: {
            id: "child-run",
            type: "commandExecution",
            command: "pnpm test --coverage",
            status: "inProgress",
          },
        });
        this.emit("thread/tokenUsage/updated", {
          tokenUsage: {
            last: { totalTokens: 32000 },
            total: { totalTokens: 64000 },
            modelContextWindow: 128000,
          },
        });
      }
      this.emit("item/started", {
        item: { id: `message-${this.turnId}`, type: "agentMessage", text: "" },
      });
      this.emit("item/agentMessage/delta", {
        itemId: `message-${this.turnId}`,
        delta: "Hello from ",
      });
      if (!text.includes("hold"))
        setTimeout(() => {
          this.emit("item/completed", {
            item: { id: `message-${this.turnId}`, type: "agentMessage", text: "Hello from Codex" },
          });
          this.finish();
        }, 150);
    }
    return { turn: { id: this.turnId, status: "inProgress", items: [] } };
  }
  finish(status = "completed", turnId = this.turnId) {
    this.emit("turn/completed", {
      turn: {
        id: turnId,
        status,
        items: [],
        error: status === "failed" ? { message: "Fixture failure" } : null,
      },
    });
  }
  /** Fixed windows, including a model-scoped weekly one, so tests can read real bars. */
  async planUsage(): Promise<AgentPlanUsage> {
    return {
      provider: "codex",
      status: "available",
      planLabel: "Max 20x",
      message: null,
      windows: [
        {
          id: "five-hour",
          label: "Session",
          usedPercent: 42,
          resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
        },
        {
          id: "weekly",
          label: "Weekly",
          usedPercent: 13,
          resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        },
        { id: "weekly-fable", label: "Weekly · Fable", usedPercent: 91, resetsAt: null },
      ],
      fetchedAt: Date.now(),
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
