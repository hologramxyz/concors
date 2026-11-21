import { expect, it } from "vitest";
import type { AgentPending } from "@concors/protocol";
import { quickChoices } from "./quick-choices";

const approval = {
  id: "00000000-0000-4000-8000-000000000001",
  turnId: "turn-1",
  kind: "approval",
  title: "Allow command execution?",
  summary: "pnpm test",
  detail: "{}",
  decisions: ["accept", "decline", "cancel"],
  questions: [],
} satisfies AgentPending;

it("offers allowing once and declining, as the chat's own buttons do", () => {
  expect(quickChoices(approval)).toEqual({
    allow: { decision: "accept", label: "Allow once" },
    decline: { decision: "decline", label: "Decline" },
  });
  // Of Codex's ways to accept, only "once" is offered away from the chat.
  expect(
    quickChoices({
      ...approval,
      actions: [
        { id: "acceptForSession", label: "Allow for this session", decision: "accept" },
        { id: "accept", label: "Allow once", decision: "accept" },
        { id: "decline", label: "Decline", decision: "decline" },
      ],
    }),
  ).toEqual({
    allow: { decision: "accept", actionId: "accept", label: "Allow once" },
    decline: { decision: "decline", actionId: "decline", label: "Decline" },
  });
});

it("never offers a lasting grant, whatever order a harness lists its choices in", () => {
  // As the ACP adapter passes a harness's options: its own IDs and names, "always" first.
  const acp = (options: [string, string, "accept" | "decline"][]) =>
    quickChoices({
      ...approval,
      actions: [
        ...options.map(([id, label, decision]) => ({ id, label, decision })),
        { id: "concors:cancel", label: "Cancel turn", decision: "cancel" as const },
      ],
    });
  expect(
    acp([
      ["proceed_always", "Allow always", "accept"],
      ["proceed_once", "Allow", "accept"],
      ["reject_always", "Always reject", "decline"],
      ["cancel", "Reject", "decline"],
    ]),
  ).toEqual({
    allow: { decision: "accept", actionId: "proceed_once", label: "Allow" },
    decline: { decision: "decline", actionId: "cancel", label: "Reject" },
  });
  expect(
    acp([
      ["proceed_always", "Allow always", "accept"],
      ["reject_once", "Reject", "decline"],
    ]),
  ).toBeNull();
  // Codex without its plain "accept": for the session, or a command rule, are left to the chat.
  expect(
    quickChoices({
      ...approval,
      actions: [
        { id: "acceptForSession", label: "Allow for this session", decision: "accept" },
        { id: "native:1", label: "Approve command rule", decision: "accept" },
        { id: "decline", label: "Decline", decision: "decline" },
      ],
    }),
  ).toBeNull();
});

it("leaves plans, mode changes, questions and requests without both answers to the chat", () => {
  expect(quickChoices({ ...approval, plan: "1. Build it" })).toBeNull();
  expect(quickChoices({ ...approval, plan: "" })).toBeNull();
  expect(quickChoices({ ...approval, approvalKind: "plan" })).toBeNull();
  expect(quickChoices({ ...approval, approvalKind: "mode" })).toBeNull();
  expect(quickChoices({ ...approval, approvalKind: "tool" })).not.toBeNull();
  expect(quickChoices({ ...approval, kind: "questions" })).toBeNull();
  expect(quickChoices({ ...approval, decisions: ["accept", "cancel"] })).toBeNull();
});
