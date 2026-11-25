import { expect, it } from "vitest";
import type { AgentItem, AgentPending } from "@concors/protocol";
import {
  approvalDetails,
  approvalItemId,
  reviewView,
  rowDescription,
  rowReviewView,
  shellCommand,
  waitWords,
} from "./approval-details";

const IDS = { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" };

/** An approval as the daemon builds one: its summary, and the request itself as its details. */
const approval = (
  params: Record<string, unknown>,
  summary: string,
  extra: Partial<AgentPending> = {},
): AgentPending => ({
  id: "00000000-0000-4000-8000-000000000001",
  turnId: "turn-1",
  kind: "approval",
  title: "Allow command execution?",
  summary,
  detail: JSON.stringify(params, null, 2),
  decisions: ["accept", "decline", "cancel"],
  questions: [],
  ...extra,
});

/** Claude Code's request: the tool's input as the command, the tool's name as the reason. */
const claude = (tool: string, input: Record<string, unknown>) => {
  const command = JSON.stringify(input);
  return approval(
    { ...IDS, reason: tool, command, availableDecisions: ["accept", "decline", "cancel"] },
    `${command}\n${tool}`,
  );
};

const shown = (pending: AgentPending, item?: AgentItem) =>
  JSON.stringify(approvalDetails(pending, item));

it("shows a file write as its path and content, line breaks and all", () => {
  const pending = claude("Write", {
    file_path: "/work/haiku.txt",
    content: "Maple leaves let go\ndrifting on the cooling wind\n",
  });
  expect(approvalDetails(pending)).toEqual({
    view: {
      kind: "write",
      path: "/work/haiku.txt",
      diff: "+Maple leaves let go\n+drifting on the cooling wind",
    },
    repeats: false,
  });
});

it("reads a write whose details were cut off, up to the cut", () => {
  const pending = claude("Write", { file_path: "/work/big.txt", content: "a\n".repeat(20000) });
  pending.detail = pending.detail.slice(0, 16000);
  const details = approvalDetails(pending);
  expect(details?.view.kind).toBe("write");
  expect(details?.view.kind === "write" && details.view.diff.startsWith("+a\n+a")).toBe(true);
  expect(details?.view.kind === "write" && details.view.diff.endsWith("…")).toBe(true);
});

it("shows an edit as the diff of what it takes out and puts in", () => {
  expect(
    approvalDetails(
      claude("Edit", {
        file_path: "/work/a.ts",
        old_string: "let a = 1;",
        new_string: "const a = 1;",
      }),
    ),
  ).toEqual({
    view: { kind: "edit", files: [{ path: "/work/a.ts", diff: "-let a = 1;\n+const a = 1;" }] },
    repeats: false,
  });
});

it("joins a multi-edit's replacements under its one file", () => {
  const details = approvalDetails(
    claude("MultiEdit", {
      file_path: "/work/a.ts",
      edits: [
        { old_string: "a", new_string: "b" },
        { old_string: "c", new_string: "d" },
      ],
    }),
  );
  expect(details?.view).toEqual({
    kind: "edit",
    files: [{ path: "/work/a.ts", diff: "-a\n+b\n-c\n+d" }],
  });
});

it("shows a Codex file change from the item its request names", () => {
  const pending = approval({ ...IDS, reason: "Update the HUD" }, "Update the HUD", {
    title: "Allow file changes?",
  });
  const item = {
    id: "item-1",
    sessionId: "s",
    turnId: "turn-1",
    position: 1,
    revision: 1,
    kind: "tool",
    title: "Edit files",
    text: "File changes",
    detail: "",
    status: "running",
    createdAt: "2026-11-24T00:00:00.000Z",
    presentation: {
      type: "files",
      fileOperation: "edit",
      files: [{ path: "/work/hud.ts", diff: "@@ -1 +1 @@\n-old\n+new" }],
    },
  } as AgentItem;
  expect(approvalItemId(pending)).toBe("item-1");
  expect(approvalDetails(pending, item)?.view).toEqual({
    kind: "edit",
    files: [{ path: "/work/hud.ts", diff: "@@ -1 +1 @@\n-old\n+new" }],
  });
  // Without the item there is nothing to show but its IDs, which are never shown.
  expect(approvalDetails(pending)).toBeNull();
});

it("shows a Codex command in full with its folder, unwrapped from its shell", () => {
  const details = approvalDetails(
    approval(
      { ...IDS, command: ["/bin/zsh", "-lc", "pnpm test"], cwd: "/work/star-catcher" },
      "pnpm test",
    ),
  );
  expect(details).toEqual({
    view: { kind: "command", command: "pnpm test", folder: "/work/star-catcher" },
    repeats: true,
  });
});

it("gives a short command with nothing else nothing to review", () => {
  expect(approvalDetails(approval({ ...IDS, command: "echo test" }, "echo test"))).toEqual({
    view: { kind: "command", command: "echo test" },
    repeats: true,
  });
  expect(approvalDetails(claude("Bash", { command: "git status" }))?.repeats).toBe(true);
});

it("offers a long command, which the card cuts to three lines", () => {
  const script = "set -e\npnpm install\npnpm build\npnpm test";
  expect(approvalDetails(approval({ ...IDS, command: script }, script))).toEqual({
    view: { kind: "command", command: script },
    repeats: false,
  });
  const long = `echo ${"x".repeat(700)}`;
  expect(approvalDetails(approval({ ...IDS, command: long }, long.slice(0, 3000)))?.repeats).toBe(
    false,
  );
});

it("says how long Claude Code's shell may run, in words", () => {
  expect(
    approvalDetails(claude("Bash", { command: "pnpm test", timeout: 120000, description: "Test" })),
  ).toEqual({
    view: { kind: "command", command: "pnpm test", timeout: "Times out after 2 minutes" },
    repeats: true,
    description: "Test",
  });
  expect(waitWords(1000)).toBe("Times out after 1 second");
  expect(waitWords(90000)).toBe("Times out after 1.5 minutes");
  expect(waitWords(0)).toBeUndefined();
});

it("names the host a command would reach", () => {
  expect(
    approvalDetails(
      approval(
        { ...IDS, command: "curl example.com", networkApprovalContext: { host: "example.com" } },
        "curl example.com\nNetwork access: {}",
      ),
    )?.view,
  ).toEqual({ kind: "command", command: "curl example.com", network: "example.com" });
});

it("shows another tool's own input, as the chat shows it, never the request's IDs", () => {
  const details = approvalDetails(
    claude("mcp__github__create_issue", { title: "Crash", body: "It crashes" }),
  );
  expect(details).toEqual({
    view: { kind: "input", text: JSON.stringify({ title: "Crash", body: "It crashes" }, null, 2) },
    repeats: false,
  });
  expect(shown(claude("WebFetch", { url: "https://a.dev", prompt: "Summarise" }))).not.toMatch(
    /thread-1|turn-1|item-1/,
  );
});

it("has nothing to add to a search the card names in full", () => {
  expect(approvalDetails(claude("WebSearch", { query: "vitest" }))?.repeats).toBe(true);
});

it("lists OpenCode's patterns, which the card shows already", () => {
  const command = JSON.stringify(["git status", "git diff"]);
  expect(
    approvalDetails(approval({ ...IDS, reason: "bash", command }, `${command}\nbash`)),
  ).toEqual({ view: { kind: "input", text: "git status\ngit diff" }, repeats: true });
});

it("shows Pi's message as words", () => {
  const command = JSON.stringify("Delete the build folder?");
  expect(approvalDetails(approval({ ...IDS, reason: "Confirm", command }, command))?.view).toEqual({
    kind: "input",
    text: "Delete the build folder?",
  });
});

it("leaves a plan to the card, which shows it whole", () => {
  expect(
    approvalDetails(
      approval({ ...IDS, approvalKind: "plan", plan: "## Plan" }, "", {
        approvalKind: "plan",
        plan: "## Plan",
      }),
    ),
  ).toBeNull();
});

it("keeps an unknown request's own fields as JSON, without its IDs or choices", () => {
  const pending = approval(
    { ...IDS, approvalKind: "mode", mode: "acceptEdits", actions: [{ id: "a" }], reason: "Why" },
    "Why",
    { approvalKind: "mode" },
  );
  expect(approvalDetails(pending)?.view).toEqual({
    kind: "input",
    text: JSON.stringify({ mode: "acceptEdits" }, null, 2),
  });
  expect(approvalDetails(approval({ ...IDS, reason: "Why" }, "Why"))).toBeNull();
});

it("shows nothing for questions or details it cannot read", () => {
  expect(approvalDetails({ ...claude("Bash", { command: "ls" }), kind: "questions" })).toBeNull();
  expect(
    approvalDetails({ ...claude("Bash", { command: "ls" }), detail: "{ not json" }),
  ).toBeNull();
});

it("unwraps the shells agents wrap commands in", () => {
  expect(shellCommand("bash -lc 'pnpm test'")).toBe("pnpm test");
  expect(shellCommand(["pwsh", "-Command", "Get-ChildItem"])).toBe("Get-ChildItem");
  expect(shellCommand(["git", "status"])).toBe("git status");
});

it("leaves out a command the card shows whole, keeping only where it runs and how long", () => {
  const folder = approvalDetails(
    approval({ ...IDS, command: "pnpm test", cwd: "/work/star-catcher" }, "pnpm test"),
  );
  expect(reviewView(folder, true)).toEqual({ kind: "command", folder: "/work/star-catcher" });
  // Cut short on the card (clamped at its width), the command comes back in full.
  expect(reviewView(folder, false)).toEqual({
    kind: "command",
    command: "pnpm test",
    folder: "/work/star-catcher",
  });
  const timeout = approvalDetails(claude("Bash", { command: "pnpm test", timeout: 60000 }));
  expect(reviewView(timeout, true)).toEqual({
    kind: "command",
    timeout: "Times out after 1 minute",
  });
  const network = approvalDetails(
    approval(
      { ...IDS, command: "curl example.com", networkApprovalContext: { host: "example.com" } },
      "curl example.com\nNetwork access: {}",
    ),
  );
  expect(reviewView(network, true)).toEqual({ kind: "command", network: "example.com" });
});

it("offers no details for a command the card shows whole with nothing else to say", () => {
  const plain = approvalDetails(approval({ ...IDS, command: "echo test" }, "echo test"));
  expect(reviewView(plain, true)).toBeNull();
  expect(reviewView(plain, false)).toEqual({ kind: "command", command: "echo test" });
  // A long script the card cuts to three lines is always shown in full.
  const script = "set -e\npnpm install\npnpm build\npnpm test";
  const cut = approvalDetails(approval({ ...IDS, command: script }, script));
  expect(cut?.repeats).toBe(false);
  // The card passes whether it shows the command whole: `repeats`, unless its width clamps it.
  expect(reviewView(cut, !!cut?.repeats)).toEqual({
    kind: "command",
    command: script,
  });
});

it("keeps a file's content and anything the card does not quote", () => {
  const write = approvalDetails(claude("Write", { file_path: "/w/a.txt", content: "a" }));
  expect(reviewView(write, true)?.kind).toBe("write");
  const search = approvalDetails(claude("WebSearch", { query: "vitest" }));
  expect(reviewView(search, true)).toBeNull();
  expect(reviewView(search, false)?.kind).toBe("input");
  expect(reviewView(null, true)).toBeNull();
});

it("reads Claude Code's description of a command apart from the command", () => {
  const details = approvalDetails(
    claude("Bash", { command: "pnpm test", description: "  Run the unit tests " }),
  );
  expect(details?.description).toBe("Run the unit tests");
  expect(reviewView(details, true)).toBeNull();
  expect(approvalDetails(claude("Bash", { command: "ls", description: "" }))).not.toHaveProperty(
    "description",
  );
});

it("gives the Supervisor's pending block only what its quoted action leaves out", () => {
  // A command the block quotes whole, which its state line opens in place: only its facts.
  const long = 'cd "/w" && for i in $(seq 1 60); do sleep 10; done';
  const withFolder = approvalDetails(approval({ ...IDS, command: long, cwd: "/w" }, long));
  expect(rowReviewView(withFolder, long)).toEqual({ kind: "command", folder: "/w" });
  expect(
    rowReviewView(approvalDetails(approval({ ...IDS, command: long }, long)), long),
  ).toBeNull();
  // A quote cut short leaves the command to the details.
  expect(rowReviewView(withFolder, 'cd "/w" && for i in')).toEqual({
    kind: "command",
    command: long,
    folder: "/w",
  });
  // A file request quotes its tool and file; the details hold what it would write or change.
  const write = approvalDetails(claude("Write", { file_path: "/w/haiku.txt", content: "a\nb" }));
  expect(rowReviewView(write, "Write haiku.txt")).toEqual({
    kind: "write",
    path: "/w/haiku.txt",
    diff: "+a\n+b",
  });
  const edit = approvalDetails(
    claude("Edit", { file_path: "/w/haiku.txt", old_string: "a", new_string: "b" }),
  );
  expect(rowReviewView(edit, "Edit haiku.txt")?.kind).toBe("edit");
  // A search the block quotes says nothing more in details.
  expect(
    rowReviewView(approvalDetails(claude("WebSearch", { query: "vitest" })), "vitest"),
  ).toBeNull();
});

it("offers the Supervisor's block nothing for a Codex file change, whose diff it does not have", () => {
  const change = approval({ ...IDS, reason: "Update the HUD" }, "Update the HUD", {
    title: "Allow file changes?",
  });
  expect(rowReviewView(approvalDetails(change), "Update the HUD")).toBeNull();
});

it("puts Claude Code's description above a command the Supervisor's block quotes", () => {
  const described = approvalDetails(
    claude("Bash", { command: "pnpm test", description: "Run the unit tests" }),
  );
  expect(rowDescription(described, true)).toBe("Run the unit tests");
  // A row whose action is not that command keeps to its action.
  expect(rowDescription(described, false)).toBeUndefined();
  expect(rowDescription(approvalDetails(claude("Bash", { command: "ls" })), true)).toBeUndefined();
  expect(rowDescription(null, true)).toBeUndefined();
});
