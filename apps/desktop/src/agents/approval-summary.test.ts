import { describe, expect, it } from "vitest";
import type { AgentPending } from "@concors/protocol";
import { approvalParts, approvalSummary, leadPreview } from "./approval-summary";

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

it("leads with the command, keeping its reason", () => {
  expect(approvalSummary(approval("pnpm test\nRun the suite"))).toBe("pnpm test\nRun the suite");
});

it("names a file request by its tool and path, not the raw payload", () => {
  expect(approvalSummary(approval('{"file_path":"/work/src/a.ts","content":"x"}\nWrite'))).toBe(
    "Write · /work/src/a.ts",
  );
  expect(approvalSummary(approval('{"command":"git push"}\nBash'))).toBe("git push");
});

it("holds a file request's tool and path apart, for a card to lay out without a separator", () => {
  expect(approvalParts(approval('{"file_path":"/w/a.ts"}\nEdit\nFolder: /w'))).toEqual({
    lead: "Edit · /w/a.ts",
    tool: "Edit",
    target: "/w/a.ts",
    path: true,
    grants: ["Folder: /w"],
  });
  expect(approvalParts(approval('{"url":"https://example.com"}\nWebFetch'))).toMatchObject({
    tool: "WebFetch",
    target: "https://example.com",
    path: false,
  });
  expect(approvalParts(approval("pnpm test\nRun the suite"))).toEqual({
    lead: "pnpm test\nRun the suite",
    grants: [],
  });
});

it("always shows the folder and network access an approval would grant", () => {
  expect(
    approvalSummary(
      approval(
        'curl example.com\nFetch docs\nFolder: /home/me\nNetwork access: {"host":"example.com"}',
      ),
    ),
  ).toBe("curl example.com\nFetch docs\nFolder: /home/me\nRequests network access");
  expect(approvalSummary(approval('Network access: {"host":"example.com"}'))).toBe(
    "Requests network access",
  );
  expect(approvalSummary(approval('{"file_path":"/w/a.ts"}\nEdit\nFolder: /w'))).toBe(
    "Edit · /w/a.ts\nFolder: /w",
  );
});

it("names a request whose input was too long for the summary", () => {
  // The daemon cut a large Write at its summary limit, losing the tool name after it.
  const content = "x".repeat(5000);
  const summary = `{"file_path":"/w/index.html","content":"${content}`.slice(0, 4000);
  const detail = JSON.stringify(
    { threadId: "t", turnId: "turn-1", reason: "Write", command: `{"file_path":"/w/index.html"}` },
    null,
    2,
  );
  expect(approvalSummary({ ...approval(summary), detail })).toBe("Write · /w/index.html");
  const command = approvalSummary(approval(`{"command":"npm test && ${content}`.slice(0, 4000)));
  expect(command).toMatch(/^npm test && x+/);
  expect(command.length).toBeLessThanOrEqual(600);
});

it("says what other tools act on, and at the least names the tool", () => {
  expect(
    approvalSummary(approval('{"url":"https://example.com","prompt":"Read it"}\nWebFetch')),
  ).toBe("WebFetch · https://example.com");
  expect(approvalSummary(approval('{"todos":[]}\nTodoWrite'))).toBe("TodoWrite");
  expect(
    approvalSummary({
      ...approval('{"todos":[{"content":"x'),
      detail: '{\n  "reason": "TodoWrite",\n  "command": "{\\"todos\\":',
    }),
  ).toBe("TodoWrite");
});

it("reads a cut-off value whole up to the cut, escapes and all", () => {
  // A Windows command cut right after an escaped backslash, and one inside a \u escape.
  expect(approvalSummary(approval('{"command":"dir C:\\\\Users\\\\'))).toBe("dir C:\\Users\\…");
  expect(approvalSummary(approval('{"command":"echo caf\\u00'))).toBe("echo caf…");
});

describe("leadPreview", () => {
  it("keeps a request's first three lines, so its answers stay in view under a long script", () => {
    expect(leadPreview("git push")).toBe("git push");
    expect(leadPreview("a\nb\nc")).toBe("a\nb\nc");
    expect(leadPreview("cat > a.js <<'EOF'\none\ntwo\nthree\nEOF")).toBe(
      "cat > a.js <<'EOF'\none\ntwo …",
    );
  });
});
