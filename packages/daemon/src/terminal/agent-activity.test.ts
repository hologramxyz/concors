import { expect, it } from "vitest";
import { terminalAgentActivity } from "./agent-activity.ts";

it("distinguishes Codex's working, idle and approval titles", () => {
  expect(terminalAgentActivity("codex", "⠙ Fix the bug", [])).toBe("working");
  expect(terminalAgentActivity("codex", "Codex", [])).toBe("idle");
  expect(terminalAgentActivity("codex", "Action Required", [])).toBe("needs_input");
  expect(terminalAgentActivity("codex", "Action Required ⠋", [])).toBe("needs_input");
});

const prompt = (above: string[], input = "❯ ") => [
  ...above,
  "────────────────────",
  input,
  "────────────────────",
  "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents",
];

it.each(["*", "·", "✢", "✶", "✻", "✽"])(
  "detects Claude's %s spinner without OSC titles",
  (spinner) => {
    expect(
      terminalAgentActivity("claude", "", prompt([`${spinner} Thinking… (12s · ↓ 120 tokens)`])),
    ).toBe("working");
    expect(terminalAgentActivity("claude", "✳ Claude", prompt([`${spinner} Thinking…`]))).toBe(
      "working",
    );
  },
);

it("detects live tools, background agents and wrapped MCP tasks", () => {
  for (const line of [
    "⏵ Running tests · esc to interrupt",
    "✻ Waiting for 2 background agents to finish",
  ])
    expect(terminalAgentActivity("claude", "", prompt([line]))).toBe("working");
  expect(
    terminalAgentActivity(
      "claude",
      "",
      prompt(["✻ Running tools · 2 MCP tasks", "  still running"]),
    ),
  ).toBe("working");
});

it("returns to idle on completion and ignores output history and typed spinner examples", () => {
  expect(terminalAgentActivity("claude", "", prompt(["✻ Cooked for 52s"]), "working")).toBe("idle");
  expect(terminalAgentActivity("claude", "", prompt(["✻ Thinking…", "Finished response"]))).toBe(
    "idle",
  );
  expect(terminalAgentActivity("claude", "", prompt([], "❯ Explain ✻ Thinking…"))).toBe("idle");
  expect(terminalAgentActivity("claude", "", prompt([], "❯ Example:\n✻ Thinking…"))).toBe("idle");
  expect(terminalAgentActivity("claude", "✳ Ready", [])).toBe("idle");
});

it("prioritizes live permission controls over a stale working title", () => {
  const approval = [
    "────────────────────",
    "Do you want to proceed?",
    "❯ 1. Yes",
    "  2. No",
    "Esc to cancel",
  ];
  expect(terminalAgentActivity("claude", "◐ Working", approval)).toBe("needs_input");
  expect(
    terminalAgentActivity("claude", "", [
      "────────────────────",
      "Enter to select · Esc to cancel",
    ]),
  ).toBe("needs_input");
  expect(terminalAgentActivity("claude", "", prompt(approval))).toBe("idle");
});

it("keeps the previous state while the user views a transcript", () => {
  const transcript = ["✻ Thinking…", "Showing detailed transcript · ctrl+o to toggle"];
  expect(terminalAgentActivity("claude", "", transcript, "idle")).toBe("idle");
  expect(terminalAgentActivity("claude", "", transcript, "working")).toBe("working");
});

it("only uses live, anchored working indicators as a screen fallback", () => {
  const working = "• Working (5s • esc to interrupt)";
  expect(terminalAgentActivity("codex", "", [working, "", ""])).toBe("working");
  expect(terminalAgentActivity("codex", "", [working, "old", "output", "prompt"])).toBe("unknown");
  expect(terminalAgentActivity("codex", "", [`› Explain ${working}`])).toBe("unknown");
  expect(terminalAgentActivity("codex", "", ["CODEX_TERMINAL_READY"])).toBe("unknown");
});

it("recognizes Claude busy titles without inventing activity for ordinary shells", () => {
  expect(terminalAgentActivity("claude", "◐ Refactoring", [])).toBe("working");
  expect(terminalAgentActivity("shell", "⠙ Fix the bug", [])).toBe("unknown");
  expect(terminalAgentActivity("opencode", "ordinary title", [])).toBe("unknown");
});
