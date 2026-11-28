import { expect, it } from "vitest";
import type { AgentPending } from "@concors/protocol";
import { askQuestion } from "./ask-question";

const approval = (summary: string) =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    turnId: "turn-1",
    kind: "approval",
    title: "Allow command execution?",
    summary,
    detail: "{}",
    decisions: ["accept", "decline"],
    questions: [],
  }) satisfies AgentPending;

const home = (path: string) => path.replace(/^\/Users\/me(?=\/)/, "~");
const roots = ["/Users/me/work/app/.worktrees/qa", "/Users/me/work/app"];

it("drops the cd prefix from a command, as chat rows do", () => {
  expect(
    askQuestion(
      "Game QA",
      approval('cd "/Users/me/work/app" && pnpm test\nRun the suite'),
      roots,
      home,
    ),
  ).toBe("Should I approve @Game QA’s request “pnpm test”?");
  // A bare cd is the command itself.
  expect(askQuestion("Game QA", approval("cd /tmp"), roots, home)).toBe(
    "Should I approve @Game QA’s request “cd /tmp”?",
  );
});

it("names a file by the shortened path the approval card shows", () => {
  const inChat = approval('{"file_path":"/Users/me/work/app/.worktrees/qa/src/a.ts"}\nEdit');
  expect(askQuestion("Game QA", inChat, roots, home)).toBe(
    "Should I approve @Game QA’s request “Edit src/a.ts”?",
  );
  // Outside the chat's folder but in its workspace: from the workspace, not a long ~/… path.
  const inWorkspace = approval('{"file_path":"/Users/me/work/app/package.json"}\nEdit');
  expect(askQuestion("Game QA", inWorkspace, roots, home)).toBe(
    "Should I approve @Game QA’s request “Edit package.json”?",
  );
  const elsewhere = approval('{"file_path":"/Users/me/notes/todo.md"}\nWrite');
  expect(askQuestion("Game QA", elsewhere, roots, home)).toBe(
    "Should I approve @Game QA’s request “Write ~/notes/todo.md”?",
  );
});

it("keeps the 120-character cut", () => {
  const long = `cd /w && echo ${"x".repeat(200)}`;
  const question = askQuestion("Game QA", approval(long), roots, home);
  expect(question).toBe(`Should I approve @Game QA’s request “echo ${"x".repeat(115)}”?`);
});

it("asks what to do when the request names nothing", () => {
  expect(askQuestion("Game QA", approval(""), roots, home)).toBe(
    "What should I do about @Game QA’s pending request?",
  );
});
