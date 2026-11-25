import type { AgentProviderId } from "@concors/protocol";
import type { AgentPlanUsage } from "@concors/protocol";
import type { AgentProvider, AgentProviderFactory } from "../manager.ts";

/** The command a fixture asks to run: one short, one long enough to wrap, any other a stand-in. */
const approvalCommand = (text: string) =>
  text === "Please approve the test command"
    ? "pnpm test"
    : text === "Please approve the long command"
      ? 'cd "/tmp/concors-fixture/star-catcher" && for i in $(seq 1 60); do if [ -s haiku.txt ]; then echo READY; exit 0; fi; sleep 10; done; echo TIMEOUT'
      : "echo test";

/**
 * A file request as Claude Code sends one: the tool's input as the command, the tool as the
 * reason. The haiku prompts ask to write a file or to edit one; any other asks to run a command.
 */
const fileRequest = (text: string, cwd: string) => {
  const file_path = `${cwd}/haiku.txt`;
  const input =
    text === "Please approve the haiku write"
      ? {
          file_path,
          content: "Maple leaves let go\ndrifting on the cooling wind\ndusk arrives sooner\n",
        }
      : text === "Please approve the haiku edit"
        ? { file_path, old_string: "dusk arrives sooner", new_string: "night arrives sooner" }
        : null;
  if (!input) return null;
  return { reason: "content" in input ? "Write" : "Edit", command: JSON.stringify(input) };
};

/** Deterministic provider used only by integration tests and the acceptance-test server. */
export class TestAgentProvider implements AgentProvider {
  static turns = 0;
  /** Like Codex, takes attachments mid-turn; a test turns it off for agents that cannot. */
  static steerAttachments = true;
  /** Per provider id, the folders `session/folders` reports, as a CLI's own history would. */
  static recentFolders: Record<string, { directory: string; updatedAt: string }[]> = {};
  readonly listeners = new Set<(method: string, params: unknown) => void>();
  readonly onRequest: Parameters<AgentProviderFactory>[1];
  readonly requests: { method: string; params: unknown }[] = [];
  threadId = "fixture-thread";
  cwd = process.cwd();
  turnId = "";
  closed = false;
  private childReads = 0;
  private mcpSignedIn = false;
  readonly provider: AgentProviderId;
  private readonly tools?: Parameters<AgentProviderFactory>[3] | undefined;
  constructor(
    onRequest: Parameters<AgentProviderFactory>[1],
    provider: AgentProviderId = "codex",
    tools?: Parameters<AgentProviderFactory>[3],
  ) {
    this.provider = provider;
    this.tools = tools;
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
  private async supervisorControl(operation: Record<string, unknown>) {
    const url = this.tools?.env?.CONCORS_CONTROL_URL;
    const token = this.tools?.env?.CONCORS_CONTROL_TOKEN;
    if (!url || !token) throw new Error("Fixture Supervisor tools unavailable");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation }),
    });
    if (!response.ok) throw new Error("Fixture Supervisor control failed");
    return response.json();
  }
  async request(method: string, params: unknown = {}): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === "session/controls")
      return {
        importSessions: true,
        fork: true,
        forkFromTurn: true,
        rewind: ["conversation"],
        steer: true,
        steerAttachments: TestAgentProvider.steerAttachments,
        mcpStatus: true,
        mcpSignIn: true,
        compact: true,
        childHistory: true,
        commands: [
          { name: "compact", description: "Summarize earlier context" },
          { name: "review", description: "Review a change", argumentHint: "<target>" },
        ],
      };
    // Statuses as Claude Code reports them: Concors's own tools connect, a server needs sign-in.
    // A server whose sign-in page returns to the machine, as an OAuth MCP server's does.
    if (method === "mcp/authenticate")
      return { url: "https://example.com/oauth/github", callback: true };
    if (method === "mcp/oauthCallback") {
      const url = new URL((params as { callbackUrl: string }).callbackUrl);
      if (url.searchParams.get("code") !== "fixture-code") throw new Error("Invalid sign-in code");
      this.mcpSignedIn = true;
      return {};
    }
    if (method === "mcp/reconnect") return {};
    if (method === "mcp/status")
      return {
        servers: [
          { name: "concors-schedules", status: "connected" },
          { name: "github", status: this.mcpSignedIn ? "connected" : "needs-auth" },
        ],
      };
    if (method === "session/child-history") {
      // The sub-agent's conversation grows between reads, as a running one does.
      const reads = ++this.childReads;
      const items: Record<string, unknown>[] = [
        {
          id: "child-prompt",
          type: "userMessage",
          content: [{ type: "text", text: "Check the test coverage" }],
        },
        {
          id: "child-read",
          type: "commandExecution",
          command: "rg --files tests",
          status: "completed",
          aggregatedOutput: "tests/app.test.ts",
        },
        {
          id: "child-plan",
          type: "plan",
          steps: [
            { step: "List the tests", status: "completed" },
            { step: "Measure coverage", status: "in_progress" },
          ],
        },
      ];
      if (reads > 1)
        items.push({ id: "child-reply", type: "agentMessage", text: "Coverage is **82%**." });
      return {
        thread: {
          id: (params as { childId?: string }).childId,
          turns: [{ id: "child-turn", status: "inProgress", items }],
        },
      };
    }
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
    // Folders a test says this CLI was used in; see the fixture daemon's /e2e/recent-folders.
    if (method === "session/folders")
      return { folders: TestAgentProvider.recentFolders[this.provider] ?? [] };
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
          turns:
            this.threadId === "external-thread-77"
              ? // A long session, for checking that resuming opens at its latest messages.
                Array.from({ length: 80 }, (_, index) => ({
                  id: `long-turn-${index + 1}`,
                  status: "completed",
                  items: [
                    {
                      id: `long-user-${index + 1}`,
                      type: "userMessage",
                      content: [{ type: "text", text: `Long session prompt ${index + 1}` }],
                    },
                    {
                      id: `long-assistant-${index + 1}`,
                      type: "agentMessage",
                      text: `Long session response ${index + 1}\n\n${"A paragraph of history. ".repeat(40)}`,
                    },
                  ],
                }))
              : this.threadId.startsWith("external-thread")
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
                        {
                          id: "native-assistant",
                          type: "agentMessage",
                          text: "Saved CLI response",
                        },
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
    const text = ((input["input"] as { text: string }[])[0]?.text ?? "").replace(
      /^<concors-tools>[\s\S]*?<\/concors-tools>\n\n/,
      "",
    );
    if (
      this.tools?.env?.CONCORS_CONTROL_URL &&
      text === "Check the game and the release notes. Tell me when anything needs my approval."
    ) {
      const turnId = this.turnId;
      void this.supervisorDelegationFixture(turnId).catch(() => this.finish("failed", turnId));
      return { turn: { id: turnId, status: "inProgress", items: [] } };
    }
    if (this.tools?.env?.CONCORS_CONTROL_URL && text === "primitive-control-run") {
      const turnId = this.turnId;
      void this.supervisorControlRun(turnId).catch(() => this.finish("failed", turnId));
      return { turn: { id: turnId, status: "inProgress", items: [] } };
    }
    if (text === "primitive-usage-limit") {
      // The account ran out: how Codex fails a turn when the plan's limit is reached.
      const turnId = this.turnId;
      setTimeout(
        () =>
          this.emit("turn/completed", {
            turn: {
              id: turnId,
              status: "failed",
              items: [],
              error: {
                message: "You've hit your usage limit.",
                codexErrorInfo: "usageLimitExceeded",
              },
            },
          }),
        50,
      );
      return { turn: { id: this.turnId, status: "inProgress", items: [] } };
    }
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
    } else if (text === "primitive-tool-run") {
      // What Claude Code reports when Supervisor polls its chats: one tool, called back to back.
      const call = (id: string, tool: string, args: unknown) =>
        this.emit("item/completed", {
          item: {
            id: `${id}-${this.turnId}`,
            type: "mcpToolCall",
            status: "completed",
            tool,
            arguments: args,
            result: "ok",
          },
        });
      call("tool-search", "ToolSearch", { query: "select:concors_control" });
      for (const kind of ["workspaces", "sessions", "status"])
        call(`control-${kind}`, "mcp__concors-supervisor__concors_control", {
          operation: { kind },
        });
      this.finish();
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
      const file = fileRequest(text, this.cwd);
      if (!file)
        this.emit("item/started", {
          item: {
            id: `tool-${this.turnId}`,
            type: "commandExecution",
            command: approvalCommand(text),
            status: "inProgress",
          },
        });
      void this.onRequest(
        "item/commandExecution/requestApproval",
        {
          threadId: this.threadId,
          turnId: this.turnId,
          itemId: `tool-${this.turnId}`,
          ...(file ?? { command: approvalCommand(text) }),
          // A command runs in a folder, which the long one's details say.
          ...(text === "Please approve the long command" ? { cwd: this.cwd } : {}),
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
          if (text === "Please approve the test command") {
            this.reply(this.turnId, "The fixture test suite finished. All checks passed.");
          } else this.finish();
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
    else if (text.includes("haiku") || text.includes("long-reply")) {
      // A final reply over several lines, as Supervisor's notice of a finished chat quotes it.
      const haiku = "Maple leaves let go\ndrifting on the cooling wind\ndusk arrives sooner";
      const steps = Array.from({ length: 10 }, (_, i) => `${i + 1}. Checked step ${i + 1}.`);
      this.reply(
        this.turnId,
        text.includes("haiku")
          ? `I saved this haiku to \`haiku.txt\`:\n\n${haiku}`
          : `Release notes reviewed:\n\n${steps.join("\n")}\n\nAll ten steps pass.`,
      );
    } else {
      if (text.includes("background")) {
        // A sub-agent left working in the background, as Claude Code runs them: the turn that
        // started it ends first, and it keeps reporting into that turn until it is done.
        const turnId = this.turnId;
        const row = (activity: Record<string, unknown>[], message: string | null) => ({
          id: `background-${turnId}`,
          type: "collabAgentToolCall",
          tool: "Agent",
          agentType: "Explore",
          prompt: "Check the test coverage",
          background: true,
          receiverThreadIds: ["child-thread"],
          agentsStates: { "child-thread": { status: message ? "completed" : "running", message } },
          activity,
        });
        this.emit("item/started", { item: row([], null) });
        setTimeout(() => {
          this.emit("item/started", {
            turnId,
            item: row(
              [{ id: "step", title: "Bash", text: "pnpm test --coverage", status: "running" }],
              null,
            ),
          });
        }, 1500);
        setTimeout(() => {
          this.emit("item/completed", {
            turnId,
            item: row(
              [{ id: "step", title: "Bash", text: "pnpm test --coverage", status: "completed" }],
              "Coverage is 82%.",
            ),
          });
        }, 3500);
      }
      if (text.includes("quoted-prompt")) {
        this.emit("item/completed", {
          item: {
            id: `quoted-${this.turnId}`,
            type: "agentMessage",
            text: [
              "Here's the prompt:",
              "",
              "---",
              "",
              "> Put the site live at [the domain](https://example.com).",
              ">",
              "> **Part 1: Railway**",
              ">",
              "> 1. Open the project.",
              "> 2. Click **+ New**.",
              ">",
              "> > A note inside the prompt.",
              "",
              "That's all.",
            ].join("\n"),
          },
        });
      }
      if (text.includes("nested-link")) {
        this.emit("item/completed", {
          item: {
            id: `nested-link-${this.turnId}`,
            type: "agentMessage",
            text: "Rendered [the clip](clips/render.txt).",
          },
        });
      }
      if (text.includes("file-links")) {
        this.emit("item/completed", {
          item: {
            id: `files-link-${this.turnId}`,
            type: "agentMessage",
            text: "Read [the README](README.md) or [the code](src/main.ts#L2), not [the screenshot](/tmp/concors-shot.png).",
          },
        });
      }
      if (text.includes("file-mentions")) {
        this.emit("item/completed", {
          item: {
            id: `file-mentions-${this.turnId}`,
            type: "agentMessage",
            text: "Files are in notes:\n\n- notes/plan.md\n- `src/main.ts`\n- todo.md\n\nBuilt on Node.js; the shot is /tmp/concors-shot.png.",
          },
        });
      }
      if (text.includes("show-image")) {
        this.emit("item/completed", {
          item: {
            id: `image-${this.turnId}`,
            type: "agentMessage",
            text: "Here is the page:\n\n![The pricing page](shot.png)\n\nAnd ![a missing one](gone.png).",
          },
        });
      }
      if (text.includes("generate-image")) {
        // Codex's image generation sends the picture inline and names the file it saved, which
        // sits outside the project and may have spaces in its path.
        this.emit("item/completed", {
          item: {
            id: `generated-${this.turnId}`,
            type: "imageGeneration",
            status: "completed",
            revisedPrompt: "A brand library",
            result:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
            savedPath: "/home/ubuntu/.codex/generated images/ig_1.png",
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
            item: {
              id: `message-${this.turnId}`,
              type: "agentMessage",
              text: "Hello from Codex",
            },
          });
          this.finish();
        }, 150);
    }
    return { turn: { id: this.turnId, status: "inProgress", items: [] } };
  }
  private async supervisorDelegationFixture(turnId: string) {
    const { sessions } = (await this.supervisorControl({ kind: "sessions" })) as {
      sessions: { id: string; name: string }[];
    };
    const messages = [
      { name: "Game QA", text: "Please approve the test command" },
      { name: "HUD polish", text: "Review the HUD and hold for feedback" },
      { name: "Release editor", text: "Check the release notes" },
    ];
    for (const task of messages) {
      const target = sessions.find((session) => session.name === task.name);
      if (!target) throw new Error("Fixture worker not found");
      await this.supervisorControl({ kind: "send", sessionId: target.id, text: task.text });
      if (task.name === "HUD polish")
        await this.supervisorControl({
          kind: "send",
          sessionId: target.id,
          text: "Check touch targets after the HUD review",
        });
    }
    this.reply(
      turnId,
      "I sent work to **Game QA**, **HUD polish**, and the **Release editor**. I’ll bring blockers and results back here.",
    );
  }
  /**
   * Supervisor's calls as Claude Code reports them, on the fixture's real chats: shown, not run,
   * so the workers' state stays as the delegation fixture left it.
   */
  private async supervisorControlRun(turnId: string) {
    const { sessions } = (await this.supervisorControl({ kind: "sessions" })) as {
      sessions: { id: string; projectId: string; name: string }[];
    };
    const chat = (name: string) => {
      const found = sessions.find((session) => session.name === name);
      if (!found) throw new Error("Fixture worker not found");
      return found;
    };
    const qa = chat("Game QA"),
      hud = chat("HUD polish"),
      notes = chat("Release editor");
    const operations = [
      { kind: "sessions", query: "touch targets" },
      { kind: "send", sessionId: hud.id, text: "Check touch targets on the pause menu too" },
      { kind: "start", projectId: qa.projectId, provider: "codex", name: "Level QA" },
      { kind: "send", sessionId: qa.id, text: "Run the full suite", whenBusy: "steer" },
      { kind: "wait", sessionIds: [qa.id, hud.id], timeoutMs: 20000 },
      { kind: "read", sessionId: notes.id },
      { kind: "capabilities" },
    ];
    for (const [index, operation] of operations.entries())
      this.emit("item/completed", {
        item: {
          id: `control-${index}-${turnId}`,
          type: "mcpToolCall",
          status: "completed",
          tool: "mcp__concors-supervisor__concors_control",
          arguments: { operation },
          result: "ok",
        },
      });
    this.reply(turnId, "Both chats are on it.");
  }
  private reply(turnId: string, text: string) {
    if (this.turnId !== turnId || this.closed) return;
    this.emit("item/completed", {
      item: { id: `message-${turnId}`, type: "agentMessage", text },
    });
    this.finish("completed", turnId);
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
