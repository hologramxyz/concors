import { expect, it } from "vitest";
import type { AgentPending } from "@concors/protocol";
import { pendingAction } from "./watch.ts";

const approval = (summary: string, detail: string) =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    turnId: "turn-1",
    kind: "approval",
    title: "Allow file changes?",
    summary,
    detail,
    decisions: ["accept", "decline", "cancel"],
    questions: [],
  }) satisfies AgentPending;

it("names a file write by its tool and file, even when the request was too large to keep whole", () => {
  const input = JSON.stringify({ file_path: "/w/src/index.html", content: "x".repeat(20000) });
  const params = { threadId: "t", turnId: "turn-1", reason: "Write", command: input };
  // As the daemon saves it: the command bounded on its own, the details cut off as a whole.
  const summary = `${input.slice(0, 3000)}\nWrite\nFolder: /w`;
  const detail = JSON.stringify(params, null, 2).slice(0, 16000);
  expect(pendingAction(approval(summary, detail))).toBe("Write index.html");
  expect(pendingAction(approval(summary, JSON.stringify(params)))).toBe("Write index.html");
  const quoted = JSON.stringify({ file_path: '/w/say "hi".html', content: "x".repeat(20000) });
  expect(pendingAction(approval(`${quoted.slice(0, 3000)}\nWrite`, "{"))).toBe(
    'Write say "hi".html',
  );
  expect(pendingAction(approval("pnpm test", "{}"))).toBe("pnpm test");
});
