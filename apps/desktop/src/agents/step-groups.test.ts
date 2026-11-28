import { describe, expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import {
  commandLine,
  diffStat,
  exitCode,
  firstErrorLine,
  liveLineRow,
  liveStep,
  shellOutput,
  stepGroups,
  stepKind,
  stepSummary,
  stepTarget,
} from "./step-groups";
import { timelineView } from "./thinking";

let n = 0;
const item = (extra: Partial<AgentItem>): AgentItem => ({
  id: `item-${++n}`,
  sessionId: "session",
  turnId: "turn",
  position: n,
  revision: 0,
  kind: "tool",
  title: "Tool",
  text: "",
  detail: "",
  status: "completed",
  createdAt: "2026-11-23T00:00:00.000Z",
  ...extra,
});
const command = (text: string, extra: Partial<AgentItem> = {}) =>
  item({ title: "Run command", text, presentation: { type: "shell", command: text }, ...extra });
const read = (path: string) =>
  item({
    title: "Read file",
    text: path,
    presentation: { type: "files", fileOperation: "read", files: [{ path, diff: "" }] },
  });
const edit = (path: string) =>
  item({
    title: "Edit files",
    text: "File changes",
    presentation: { type: "files", fileOperation: "edit", files: [{ path, diff: "+a" }] },
  });
/** Claude's Write, which says in its result whether the file was new. */
const write = (path: string, type: "create" | "update" = "create") =>
  item({
    title: "Edit files",
    text: "File changes",
    detail: JSON.stringify({
      changes: [{ path, diff: "+a" }],
      input: { file_path: path, content: "a" },
      output: { content: "ok", details: { type, filePath: path } },
    }),
    presentation: { type: "files", fileOperation: "edit", files: [{ path, diff: "+a" }] },
  });
/** Codex's file change, which marks each file it added. */
const patch = (changes: { path: string; kind: "add" | "update" }[]) =>
  item({
    title: "Edit files",
    text: "File changes",
    detail: JSON.stringify({
      changes: changes.map(({ path, kind }) => ({ path, kind: { type: kind }, diff: "+a" })),
    }),
    presentation: {
      type: "files",
      fileOperation: "edit",
      files: changes.map(({ path }) => ({ path, diff: "+a" })),
    },
  });
const web = (query: string) =>
  item({ title: "Search the web", text: query, presentation: { type: "search" } });
const grep = (query: string) =>
  item({ title: "Grep", text: query, presentation: { type: "search" } });
const mcp = (tool: string) =>
  item({ title: `github · ${tool}`, text: tool, presentation: { type: "mcp", input: "{}" } });
const thought = (text: string) =>
  item({ title: "Thinking", text, presentation: { type: "thinking" } });
const message = (kind: "user" | "assistant", turnId = "turn") =>
  item({ kind, title: kind, text: "hi", turnId });
const permission = (text = "Allow once") =>
  item({ kind: "system", title: "Permission", text, id: `response:${++n}` });

describe("stepGroups", () => {
  it("folds a finished turn's run into one row under its first step's id", () => {
    const steps = [thought("**Looking**"), command("ls"), read("a.ts"), edit("a.ts")];
    const rows = stepGroups([message("user"), ...steps, message("assistant")], null);
    expect(rows.map((row) => row.kind)).toEqual(["user", "tool", "assistant"]);
    expect(rows[1]?.id).toBe(steps[0]?.id);
    expect(rows[1]?.steps).toEqual(steps);
  });

  it("shows one step on its own as a plain row, with its reasoning as it is", () => {
    const think = thought("**Looking**");
    const ls = command("ls");
    const rows = stepGroups([think, ls], null);
    expect(rows).toEqual([think, { ...ls, quiet: true }]);
  });

  it("ends a run at a failed step, which becomes a plain row of its own", () => {
    const failed = command("pnpm test", { status: "failed" });
    const rows = stepGroups([command("a"), command("b"), failed, command("c"), command("d")], null);
    expect(rows.map((row) => (row.steps ? "group" : row.quiet ? "row" : "card"))).toEqual([
      "group",
      "row",
      "group",
    ]);
    expect(rows[1]?.id).toBe(failed.id);
  });

  it("ends a run at sub-agents, plans, system lines, turns and calls an open request names", () => {
    const sub = item({ title: "Sub-agents", presentation: { type: "sub_agent" } });
    const plan = item({ kind: "plan", title: "Plan", presentation: { type: "plan" } });
    const system = item({ kind: "system", title: "Context compacted" });
    const asked = command("git push");
    const other = command("x", { turnId: "other" });
    const rows = stepGroups(
      [command("a"), sub, command("b"), plan, command("c"), system, command("d"), asked, other],
      null,
      new Set([asked.id]),
    );
    expect(rows.some((row) => row.steps)).toBe(false);
    expect(rows.find((row) => row.id === asked.id)?.quiet).toBeUndefined();
    expect(rows.find((row) => row.id === other.id)?.quiet).toBe(true);
  });

  it("opens today's same-tool folds into one row per call", () => {
    const reads = [read("a.ts"), read("b.ts"), read("c.ts")];
    const view = timelineView(reads);
    expect(view).toHaveLength(1);
    const rows = stepGroups(view, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(reads[0]?.id);
    expect(rows[0]?.steps).toEqual(reads);
  });

  it("marks a run with a stopped step as stopped", () => {
    const rows = stepGroups([command("a"), command("b", { status: "interrupted" })], null);
    expect(rows[0]?.status).toBe("interrupted");
  });
});

describe("the turn in progress", () => {
  const shape = (rows: ReturnType<typeof stepGroups>) =>
    rows.map((row) =>
      row.steps
        ? `${row.live ? "live" : "group"}:${row.status}:${row.steps.map((step) => step.text).join(",")}`
        : `${row.quiet ? "row" : row.kind}:${row.text}`,
    );

  it("folds its finished steps and leaves the running one to the live line", () => {
    const items = [message("user"), read("a.js"), read("b.js"), edit("a.js")];
    const running = command("node --test", { status: "running" });
    const view = timelineView([...items, running]);
    expect(liveStep(view, "turn")).toBe(running);
    const rows = stepGroups(view, "turn");
    expect(shape(rows)).toEqual(["user:hi", "live:running:a.js,b.js,File changes"]);
    expect(rows[1]?.id).toBe(items[1]?.id);
  });

  it("keeps the same row, under the same id, when the turn ends", () => {
    const steps = [read("a.js"), edit("a.js"), command("node --test", { status: "running" })];
    const live = stepGroups(timelineView(steps), "turn");
    const done = stepGroups(
      timelineView(steps.map((step) => ({ ...step, status: "completed" as const }))),
      null,
    );
    expect(live.map((row) => row.id)).toEqual(done.map((row) => row.id));
    expect(done[0]?.status).toBe("completed");
    expect(done[0]?.live).toBeUndefined();
  });

  it("shows only the live line while the run's first step runs", () => {
    const think = thought("**Planning**");
    const rows = stepGroups([message("user"), think, command("ls", { status: "running" })], "turn");
    expect(rows.map((row) => row.id)).toEqual([rows[0]?.id, think.id]);
  });

  it("shows one finished step as its plain row, as it will read once the turn ends", () => {
    const rows = stepGroups([read("a.js"), command("ls", { status: "running" })], "turn");
    expect(shape(rows)).toEqual(["row:a.js"]);
  });

  it("gives a run the turn is still on no ✓, even with nothing running between steps", () => {
    const rows = stepGroups([read("a.js"), read("b.js")], "turn");
    expect(shape(rows)).toEqual(["live:running:a.js,b.js"]);
  });

  it("ends a run at messages, sub-agents and failures as a finished turn does", () => {
    const sub = item({ title: "Sub-agents", presentation: { type: "sub_agent" } });
    const rows = stepGroups(
      [
        read("a.js"),
        read("b.js"),
        message("assistant"),
        command("a"),
        command("b", { status: "failed" }),
        command("c"),
        command("d"),
        sub,
      ],
      "turn",
    );
    expect(shape(rows)).toEqual([
      "group:completed:a.js,b.js",
      "assistant:hi",
      "row:a",
      "row:b",
      "group:completed:c,d",
      "tool:",
    ]);
  });

  it("keeps a run with a call still running open before a sub-agent, without a live line", () => {
    const sub = item({ title: "Sub-agents", presentation: { type: "sub_agent" } });
    const shell = command("echo", { status: "running" });
    const rows = stepGroups([edit("a.ts"), read("b.ts"), shell, sub], "turn");
    expect(liveStep([edit("a.ts"), shell, sub], "turn")).toBe(shell);
    expect(shape(rows)).toEqual(["group:running:File changes,b.ts", "tool:"]);
  });

  it("leaves a call an open request names out of the live line", () => {
    const asked = command("git push", { status: "running" });
    const view = [read("a.js"), asked];
    expect(liveStep(view, "turn", new Set([asked.id]))).toBeUndefined();
    const rows = stepGroups(view, "turn", new Set([asked.id]));
    expect(rows.at(-1)).toBe(asked);
  });

  it("shows a permission granted mid-turn on its step", () => {
    const rows = stepGroups([read("a.js"), command("ls"), permission(), read("b.js")], "turn");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.steps?.[1]?.approval).toBe("Allowed once");
  });

  it("has no live step once the turn is over", () => {
    expect(liveStep([command("ls", { status: "running" })], null)).toBeUndefined();
  });
});

describe("approvals", () => {
  const marks = (rows: ReturnType<typeof stepGroups>) =>
    rows.flatMap((row) => row.steps ?? [row]).map((row) => [row.title, row.approval ?? null]);

  it("shows each granted permission on the call it was for, in the order the calls asked", () => {
    // As Claude saves them: each answer after its call, two calls of one message answered in turn.
    const rows = stepGroups(
      [
        message("user"),
        command("node --test", { status: "failed" }),
        permission(),
        message("assistant"),
        read("a.js"),
        read("a.test.js"),
        edit("a.js"),
        command("node --test"),
        permission(),
        permission("Allow for this session"),
        message("assistant"),
      ],
      null,
    );
    expect(rows.some((row) => row.title === "Permission")).toBe(false);
    expect(rows.map((row) => row.kind)).toEqual(["user", "tool", "assistant", "tool", "assistant"]);
    expect(marks(rows)).toEqual([
      ["user", null],
      ["Run command", "Allowed once"],
      ["assistant", null],
      ["Read file", null],
      ["Read file", null],
      ["Edit files", "Allowed once"],
      ["Run command", "Allowed for this session"],
      ["assistant", null],
    ]);
  });

  it("gives an answer no earlier call could have asked for to the next step", () => {
    const rows = stepGroups([read("a.ts"), permission(), read("b.ts"), command("ls")], null);
    expect(rows).toHaveLength(1);
    expect(marks(rows)).toEqual([
      ["Read file", null],
      ["Read file", "Allowed once"],
      ["Run command", null],
    ]);
  });

  it("shows a declined permission on its step, beside one allowed", () => {
    for (const text of ["Decline", "Dismissed"]) {
      const declined = permission(text);
      const rows = stepGroups(
        [command("a"), declined, command("b"), permission(), command("c")],
        null,
      );
      expect(rows.map((row) => row.id)).not.toContain(declined.id);
      expect(marks(rows)).toEqual([
        ["Run command", "Declined"],
        ["Run command", "Allowed once"],
        ["Run command", null],
      ]);
    }
  });

  it("keeps a cancelled turn's answer as a line", () => {
    const cancelled = permission("Turn canceled");
    const rows = stepGroups([command("a"), cancelled, command("b")], null);
    expect(rows.map((row) => row.id)).toContain(cancelled.id);
  });

  it("does not let a granted permission split a run", () => {
    const rows = stepGroups([command("a"), permission(), command("b"), permission()], null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.steps?.map((step) => step.approval)).toEqual(["Allowed once", "Allowed once"]);
  });
});

describe("stepSummary", () => {
  it("names each kind when there are up to three", () => {
    expect(stepSummary([command("a"), command("b")])).toBe("Ran 2 commands");
    expect(stepSummary([command("a"), edit("x.ts"), edit("y.ts")])).toBe(
      "Ran 1 command and edited 2 files",
    );
    expect(
      stepSummary([read("a.ts"), read("b.ts"), edit("a.ts"), edit("b.ts"), web("q"), web("r")]),
    ).toBe("Read 2 files, edited 2 files and searched the web 2 times");
    expect(stepSummary([mcp("search_issues"), grep("fetch(")])).toBe(
      "Used 1 tool and searched the code 1 time",
    );
  });

  it("names the two largest of more than three kinds and counts the rest", () => {
    const steps = [
      mcp("a"),
      command("ls"),
      read("a.ts"),
      edit("x.ts"),
      edit("y.ts"),
      web("q"),
      web("r"),
    ];
    expect(stepSummary(steps)).toBe("Edited 2 files, searched the web 2 times and 3 more");
  });

  it("says a new file was created when the agent reported it", () => {
    expect(stepSummary([write("a.js"), write("b.js")])).toBe("Created 2 files");
    expect(stepSummary([write("a.js"), edit("b.js")])).toBe("Created 1 file and edited 1 file");
    expect(
      stepSummary([
        patch([
          { path: "a.js", kind: "add" },
          { path: "b.js", kind: "update" },
        ]),
      ]),
    ).toBe("Created 1 file and edited 1 file");
    // Overwriting a file that was there, or an agent that does not say, still reads as an edit.
    expect(stepSummary([write("a.js", "update"), edit("b.js")])).toBe("Edited 2 files");
  });

  it("counts a file the run created as created, even after edits to it", () => {
    expect(stepSummary([write("a.js"), edit("a.js"), edit("b.js")])).toBe(
      "Created 1 file and edited 1 file",
    );
  });

  it("calls a step a creation only when every file in it is new", () => {
    expect(stepKind(write("a.js"))).toBe("create");
    expect(stepKind(patch([{ path: "a.js", kind: "add" }]))).toBe("create");
    expect(
      stepKind(
        patch([
          { path: "a.js", kind: "add" },
          { path: "b.js", kind: "update" },
        ]),
      ),
    ).toBe("edit");
    expect(stepKind(write("a.js", "update"))).toBe("edit");
    expect(stepKind({ ...write("a.js"), detail: '{"output": {"details": {"type": "cre' })).toBe(
      "edit",
    );
  });

  it("counts a file once however often it is touched, and skips reasoning", () => {
    expect(stepSummary([edit("a.ts"), edit("a.ts"), thought("**x**"), read("a.ts")])).toBe(
      "Read 1 file and edited 1 file",
    );
  });
});

describe("step details", () => {
  it("counts a diff's added and removed lines, not its headers", () => {
    expect(diffStat("--- a\n+++ b\n-old\n+new\n+more\n context")).toEqual({ added: 2, removed: 1 });
  });

  it("finds the line of a failure that says what went wrong", () => {
    const failed = command("pnpm test", {
      status: "failed",
      detail: "/repo\n ✓ one\n × retries after a drop\nExit code: 1",
      presentation: { type: "shell", command: "pnpm test", cwd: "/repo", exitCode: 1 },
    });
    expect(firstErrorLine(failed)).toBe("× retries after a drop");
    const crashed = command("x", {
      detail: "/repo\nsegfault\nExit code: 139",
      presentation: { type: "shell", command: "x", cwd: "/repo", exitCode: 139 },
    });
    expect(firstErrorLine(crashed)).toBe("segfault");
  });

  it("prefers a test's assertion over the runner's totals", () => {
    // node --test, as the daemon saved it from a Claude chat: exit code first, no folder.
    const nodeTest = command("node --test math.test.js", {
      status: "failed",
      detail: [
        "Exit code 1",
        "✖ add adds two numbers (0.659916ms)",
        "ℹ tests 1",
        "ℹ pass 0",
        "ℹ fail 1",
        "",
        "✖ failing tests:",
        "",
        "test at math.test.js:5:1",
        "✖ add adds two numbers (0.659916ms)",
        "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
        "  ",
        "  -1 !== 5",
        "      at TestContext.<anonymous> (/tmp/math.test.js:6:10)",
      ].join("\n"),
    });
    // The assertion's first line only introduces the values, so they are read with it.
    expect(firstErrorLine(nodeTest)).toBe("Expected values to be strictly equal: -1 !== 5");
    const tap = command("node --test --test-reporter=tap", {
      status: "failed",
      detail: "# tests 1\n# fail 1\nnot ok 1 - add\n  error: 'Expected values to be equal'",
    });
    expect(firstErrorLine(tap)).toBe("error: 'Expected values to be equal'");
    const build = command("pnpm build", {
      status: "failed",
      detail: "> build\nsrc/a.ts(3,1): error TS1005: ';' wanted.\nFound 1 error.",
    });
    expect(firstErrorLine(build)).toBe("src/a.ts(3,1): error TS1005: ';' wanted.");
  });

  it("prefers a program's complaint over a listing it printed first", () => {
    const listed = command("ls -la concors-test; cat concors-test/package.json", {
      status: "failed",
      detail: [
        "Exit code 1",
        "total 16",
        "drwxr-xr-x@  4 me  staff  128 Nov 23 10:02 .",
        "drwxr-xr-x@ 12 me  staff  384 Nov 23 10:01 ..",
        "-rw-r--r--@  1 me  staff  120 Nov 23 10:02 math.js",
        "-rw-r--r--@  1 me  staff  210 Nov 23 10:02 math.test.js",
        "cat: concors-test/package.json: No such file or directory",
      ].join("\n"),
    });
    expect(firstErrorLine(listed)).toBe(
      "cat: concors-test/package.json: No such file or directory",
    );
    const missing = command("cat package.json", {
      status: "failed",
      detail: "Exit code 1\ncat: package.json: No such file or directory",
    });
    expect(firstErrorLine(missing)).toBe("cat: package.json: No such file or directory");
    const empty = command("ls -la empty", { status: "failed", detail: "Exit code 1\ntotal 0" });
    expect(firstErrorLine(empty)).toBe("");
  });

  it("reads a line that ends in a colon with the one after it", () => {
    const thrown = command("node a.js", {
      status: "failed",
      detail: "Exit code 1\nError: config is missing these keys:\n  apiUrl\n    at load (a.js:3:9)",
    });
    expect(firstErrorLine(thrown)).toBe("Error: config is missing these keys: apiUrl");
  });

  it("reads a failed command's exit code from its output when the daemon gave none", () => {
    expect(exitCode(command("x", { detail: "Exit code 1\nboom" }))).toBe(1);
    expect(exitCode(command("x", { detail: "/repo\nboom\nExit code: 2" }))).toBe(2);
    expect(
      exitCode(command("x", { presentation: { type: "shell", command: "x", exitCode: 3 } })),
    ).toBe(3);
    expect(exitCode(command("x", { detail: "boom" }))).toBeUndefined();
  });

  it("leaves the exit code out of a command's opened output, which the step's line shows", () => {
    expect(shellOutput("Exit code 1\n✖ failing tests:\n\n  -1 !== 5")).toBe(
      "✖ failing tests:\n\n  -1 !== 5",
    );
    expect(shellOutput("/repo\nboom\nExit code: 2")).toBe("/repo\nboom");
    // Only the agent's own first or last line: output that mentions an exit code keeps it.
    expect(shellOutput("a\nExit code 3\nb")).toBe("a\nExit code 3\nb");
    expect(shellOutput("Exit code 0")).toBe("");
  });

  it("shows a command's first line, marking that more follow", () => {
    expect(commandLine("pnpm test")).toBe("pnpm test");
    expect(commandLine("cat > a.js <<'EOF'\nconst a = 1;\nEOF")).toBe("cat > a.js <<'EOF' …");
  });
});

describe("stepTarget", () => {
  it("names a command as a command, keeping its text for the opened row", () => {
    const git = item({
      title: "Run command",
      text: "git fetch -q origin $(git ls-remote origin refs/heads/main)",
      presentation: { type: "shell", command: "git fetch -q origin $(git ls-remote origin)" },
    });
    expect(stepTarget(git, "command")).toBe("a command");
    // Whatever the command, failed or running, its line does not quote it.
    const script = item({
      text: "export PATH=$HOME/.bun/bin:$PATH TMPDIR=/dev/shm\nbun test",
      status: "failed",
      presentation: { type: "shell", command: "export PATH=$HOME/.bun/bin:$PATH\nbun test" },
    });
    expect(stepTarget(script, "command")).toBe("a command");
  });

  it("keeps the words other steps already read in", () => {
    const read = item({
      text: "/w/src/app.ts",
      presentation: {
        type: "files",
        fileOperation: "read",
        files: [{ path: "/w/src/app.ts", diff: "" }],
      },
    });
    expect(stepTarget(read, "read", (path) => path.replace("/w/", ""))).toBe("src/app.ts");
    expect(stepTarget(item({ text: "vitest config" }), "search")).toBe("vitest config");
    expect(stepTarget(item({ title: "mcp__github__create_issue" }), "tool")).toBe("Create issue");
  });
});

describe("liveLineRow", () => {
  // A Supervisor notice: recorded under its watch's own turn, so it cuts the live turn's runs.
  const notice = (id: string) =>
    item({
      id,
      kind: "system",
      title: "Agent result",
      text: "Sandbox finished.",
      turnId: "supervisor:watch",
    });

  it("puts one live line after the last row when two notices split a running turn", () => {
    const items = [
      item({ kind: "user", text: "Check on my chats" }),
      command("ls"),
      command("pwd"),
      notice("notice-1"),
      command("git status"),
      command("git diff"),
      notice("notice-2"),
      command("pnpm test"),
      command("pnpm lint"),
      command("pnpm build", { status: "running" }),
    ];
    const view = stepGroups(timelineView(items), "turn");
    // Each run the notices cut is still marked live, and keeps its steps.
    const live = view.filter((entry) => entry.live);
    expect(live).toHaveLength(3);
    expect(live.map((entry) => entry.steps?.length)).toEqual([2, 2, 2]);
    // The line goes only after the last row.
    expect(liveLineRow(view)).toBe(view.at(-1)?.id);
    expect(view.filter((entry) => entry.id === liveLineRow(view))).toHaveLength(1);
  });

  it("follows the whole timeline when a notice is the last row", () => {
    const items = [
      command("ls"),
      command("pwd"),
      notice("notice-1"),
      command("git status"),
      command("git diff"),
      notice("notice-2"),
    ];
    const view = stepGroups(timelineView(items), "turn");
    expect(view.filter((entry) => entry.live)).toHaveLength(2);
    expect(view.at(-1)?.id).toBe("notice-2");
    expect(liveLineRow(view)).toBeUndefined();
  });

  it("keeps a normal chat's line on its live run", () => {
    const view = stepGroups(
      timelineView([command("ls"), command("pwd"), command("git status", { status: "running" })]),
      "turn",
    );
    expect(view).toHaveLength(1);
    expect(view[0]?.live).toBe(true);
    expect(liveLineRow(view)).toBe(view[0]?.id);
  });
});
