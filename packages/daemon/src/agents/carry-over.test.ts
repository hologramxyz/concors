import { expect, it } from "vitest";
import { carryOverText } from "./carry-over.ts";

it("carries the messages, newest kept first within the budget, and nothing else", () => {
  const items = [
    { kind: "user" as const, text: "first question" },
    { kind: "tool" as const, text: "ls -la" },
    { kind: "assistant" as const, text: "first answer" },
    { kind: "system" as const, text: "Worked for 3s" },
    { kind: "user" as const, text: "second question" },
    { kind: "assistant" as const, text: "  " },
  ];
  const all = carryOverText(items);
  expect(all).toContain("User: first question\n\nAssistant: first answer\n\nUser: second question");
  expect(all).not.toContain("ls -la");
  expect(all).not.toContain("the most recent ones");
  const recent = carryOverText(items, 40);
  expect(recent).toContain("User: second question");
  expect(recent).not.toContain("first question");
  expect(recent).toContain("the most recent ones");
  expect(carryOverText([{ kind: "tool", text: "x" }])).toBe("");
});
