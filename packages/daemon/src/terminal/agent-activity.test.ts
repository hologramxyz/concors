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

// Captured from the installed Claude Code 2.1.236 during a real, tools-disabled
// explanation turn. Only its status chrome is retained; title updates are optional.
const claude236 = (status: string, footer: string) => [
  status,
  "                                                                                                            ● high · /effort",
  "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
  "❯ ",
  "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
  footer,
];

it.each(["", "✳ Claude Code"])(
  "detects the captured Claude 2.1.236 layout with title %j",
  (title) => {
    const footer =
      "  ⏸ plan mode on (shift+tab to cycle) · PR #30 · esc to interrupt · ← for agents       /rc";
    expect(
      terminalAgentActivity(
        "claude",
        title,
        claude236("✽ Metamorphosing… (8s · ↓ 490 tokens)", footer),
      ),
    ).toBe("working");
    // The footer remains authoritative while the spinner is temporarily absent in a redraw.
    expect(terminalAgentActivity("claude", title, claude236("", footer))).toBe("working");
    // And the spinner is sufficient when the footer has not yet been updated.
    expect(
      terminalAgentActivity("claude", title, claude236("✻ Ruminating…", "  ⏵⏵ auto mode on")),
    ).toBe("working");
    expect(
      terminalAgentActivity(
        "claude",
        title,
        claude236("✻ Cooked for 8s", "  ⏸ plan mode on (shift+tab to cycle) · ← for agents"),
        "working",
      ),
    ).toBe("idle");
  },
);

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
  expect(terminalAgentActivity("codex", "", [`› Explain ${working}`])).toBe("idle");
  expect(terminalAgentActivity("codex", "", ["CODEX_TERMINAL_READY"])).toBe("unknown");
});
it("recognizes Codex returning to its prompt when OSC titles are disabled", () => {
  expect(
    terminalAgentActivity("codex", "", ["Response complete", "› ", "? for shortcuts"], "working"),
  ).toBe("idle");
  expect(terminalAgentActivity("codex", "", ["• Working (5s • esc to interrupt)", "› "])).toBe(
    "working",
  );
});

it("recognizes Claude busy titles without inventing activity for ordinary shells", () => {
  expect(terminalAgentActivity("claude", "◐ Refactoring", [])).toBe("working");
  expect(terminalAgentActivity("shell", "⠙ Fix the bug", [])).toBe("unknown");
  expect(terminalAgentActivity("opencode", "ordinary title", [])).toBe("unknown");
});
