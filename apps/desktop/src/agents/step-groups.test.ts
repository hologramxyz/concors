import { describe, expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import {
  commandLine,
  diffStat,
  exitCode,
  firstErrorLine,
  stepGroups,
  stepSummary,
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

  it("leaves the turn still in progress as it is", () => {
    const view = timelineView([read("a.ts"), read("b.ts"), command("ls"), command("pwd")]);
    expect(stepGroups(view, "turn")).toEqual(view);
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

  it("keeps declined and cancelled answers, and answers in the turn in progress, as lines", () => {
    const declined = permission("Decline");
    const rows = stepGroups([command("a"), declined, command("b")], null);
    expect(rows.map((row) => row.id)).toContain(declined.id);
    const live = [command("a"), permission()];
    expect(stepGroups(live, "turn")).toEqual(live);
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
    expect(firstErrorLine(nodeTest)).toBe(
      "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
    );
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

  it("reads a failed command's exit code from its output when the daemon gave none", () => {
    expect(exitCode(command("x", { detail: "Exit code 1\nboom" }))).toBe(1);
    expect(exitCode(command("x", { detail: "/repo\nboom\nExit code: 2" }))).toBe(2);
    expect(
      exitCode(command("x", { presentation: { type: "shell", command: "x", exitCode: 3 } })),
    ).toBe(3);
    expect(exitCode(command("x", { detail: "boom" }))).toBeUndefined();
  });

  it("shows a command's first line, marking that more follow", () => {
    expect(commandLine("pnpm test")).toBe("pnpm test");
    expect(commandLine("cat > a.js <<'EOF'\nconst a = 1;\nEOF")).toBe("cat > a.js <<'EOF' …");
  });
});
