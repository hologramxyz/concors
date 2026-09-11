import { expect, it } from "vitest";
import { AgentQuestionSchema } from "@concors/protocol";
import { questionAnswers } from "./questions.ts";
import { approvalActions } from "./approval-actions.ts";
const choose = AgentQuestionSchema.parse({
  id: "choice",
  header: "Scope",
  question: "Which checks?",
  options: [
    { label: "Unit", description: "Fast" },
    { label: "Browser", description: "Full UI" },
  ],
  allowOther: false,
  multiSelect: true,
});
it("validates required, optional, single and multiple answers before settling the request", () => {
  const optional = AgentQuestionSchema.parse({
    id: "note",
    header: "Note",
    question: "Notes?",
    required: false,
    multiline: true,
  });
  expect(questionAnswers([choose, optional], { choice: ["Unit", "Browser"], note: [] })).toEqual({
    choice: { answers: ["Unit", "Browser"] },
    note: { answers: [] },
  });
  expect(() => questionAnswers([choose], { choice: [] })).toThrow("required");
  expect(() => questionAnswers([choose], { choice: ["Invented"] })).toThrow("available");
  expect(() =>
    questionAnswers([{ ...choose, multiSelect: false }], { choice: ["Unit", "Browser"] }),
  ).toThrow("one answer");
  expect(() => questionAnswers([choose], { choice: ["Unit", "Unit"] })).toThrow("once");
  expect(() => questionAnswers([choose], { wrong: ["Unit"] })).toThrow("unknown");
  expect(
    questionAnswers([{ ...choose, allowOther: true }], { choice: ["Custom check"] }).choice,
  ).toEqual({ answers: ["Custom check"] });
});
it("keeps session grants and native rule amendments distinct from one-time approval", () => {
  const amendment = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["git", "status"] } };
  const result = approvalActions({
    availableDecisions: ["accept", "acceptForSession", amendment, "decline", "cancel", "unknown"],
  });
  expect(result.actions.map((a) => a.label)).toEqual([
    "Allow once",
    "Allow for this session",
    "Approve command rule",
    "Decline",
    "Cancel turn",
  ]);
  expect(result.values.get("native:2")).toEqual(amendment);
  expect(result.values.get("acceptForSession")).toBe("acceptForSession");
  expect(() =>
    approvalActions({
      actions: [
        { id: "x", label: "A", decision: "accept" },
        { id: "x", label: "B", decision: "decline" },
      ],
    }),
  ).toThrow("Duplicate");
});
it("preserves editor indentation and line endings", () => {
  const q = AgentQuestionSchema.parse({
    id: "editor",
    header: "Edit",
    question: "Edit notes",
    multiline: true,
    required: false,
  });
  expect(questionAnswers([q], { editor: ["  line one\n  line two\n"] })).toEqual({
    editor: { answers: ["  line one\n  line two\n"] },
  });
});
