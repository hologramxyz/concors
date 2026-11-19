import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { restoreClaudeTranscript, UNSHARED_DIRECTORY } from "./claude-home.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function home(root: string, name: string) {
  const path = join(root, name);
  mkdirSync(join(path, "projects"), { recursive: true });
  return path;
}
const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

it("copies a conversation kept under another account into the one the chat runs under", () => {
  const root = mkdtempSync(join(tmpdir(), "claude-transcripts-"));
  roots.push(root);
  const current = home(root, "account-b");
  const other = home(root, "account-a");
  const id = "3f1e2d4c-0000-4000-8000-000000000003";
  write(join(other, "projects", "-repo", `${id}.jsonl`), '{"type":"user"}\n');
  write(join(other, "projects", "-repo", id, "subagents", "agent-1.jsonl"), "{}\n");

  const restored = restoreClaudeTranscript(current, [current, other], id);
  expect(restored).toBe(join(current, "projects", "-repo", `${id}.jsonl`));
  expect(readFileSync(restored!, "utf8")).toBe('{"type":"user"}\n');
  expect(existsSync(join(current, "projects", "-repo", id, "subagents", "agent-1.jsonl"))).toBe(
    true,
  );
  // The original stays, and one already in place is left alone.
  expect(existsSync(join(other, "projects", "-repo", `${id}.jsonl`))).toBe(true);
  expect(restoreClaudeTranscript(current, [other], id)).toBeUndefined();
});

it("finds a conversation set aside when two histories merged, and gives up on one found nowhere", () => {
  const root = mkdtempSync(join(tmpdir(), "claude-transcripts-"));
  roots.push(root);
  const current = home(root, "machine");
  const account = home(root, "account");
  const id = "3f1e2d4c-0000-4000-8000-000000000004";
  write(
    join(
      account,
      UNSHARED_DIRECTORY,
      "2026-11-01T00-00-00-000Z",
      "projects",
      "-app",
      `${id}.jsonl`,
    ),
    "{}\n",
  );
  expect(restoreClaudeTranscript(current, [account], id)).toBe(
    join(current, "projects", "-app", `${id}.jsonl`),
  );
  expect(restoreClaudeTranscript(current, [account], "3f1e2d4c-0000-4000-8000-00000000000f")).toBe(
    undefined,
  );
  expect(restoreClaudeTranscript(current, [account], "../escape")).toBeUndefined();
});
