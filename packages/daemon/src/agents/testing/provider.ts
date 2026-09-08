import type { AgentProvider, AgentProviderFactory } from "../manager.ts";

/** Deterministic provider used only by integration tests and the acceptance-test server. */
export class TestAgentProvider implements AgentProvider {
  static turns = 0;
  readonly listeners = new Set<(method: string, params: unknown) => void>();
  readonly onRequest: Parameters<AgentProviderFactory>[1];
  readonly requests: { method: string; params: unknown }[] = [];
  threadId = "fixture-thread";
  turnId = "";
  closed = false;
  constructor(onRequest: Parameters<AgentProviderFactory>[1]) {
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
    if (method === "model/list")
      return {
        data: [
          {
            model: "fixture",
            displayName: "Fixture model",
            supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
            defaultReasoningEffort: "high",
          },
        ],
      };
    const input = params as Record<string, unknown>;
    if (method === "thread/start" || method === "thread/resume")
      return { thread: { id: this.threadId, turns: [] }, model: "fixture" };
    if (method === "turn/interrupt") {
      this.finish("interrupted");
      return {};
    }
    if (method !== "turn/start") throw new Error(`Unexpected method: ${method}`);
    this.turnId = `turn-${++TestAgentProvider.turns}`;
    this.emit("turn/started", { turn: { id: this.turnId, status: "inProgress", items: [] } });
    const text = (input["input"] as { text: string }[])[0]?.text ?? "";
    if (text.includes("approve")) {
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
      if (text.includes("rich")) {
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
  async close(): Promise<void> {
    this.closed = true;
  }
}
