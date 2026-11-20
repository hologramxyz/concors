import { expect, it } from "vitest";
import type { AgentPending } from "@concors/protocol";
import { approvalSummary } from "./approval-summary";

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
