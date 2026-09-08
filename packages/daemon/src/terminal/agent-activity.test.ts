import { expect, it } from "vitest";
import { terminalAgentActivity } from "./agent-activity.ts";

it("distinguishes Codex's working, idle and approval titles", () => {
  expect(terminalAgentActivity("codex", "⠙ Fix the bug", [])).toBe("working");
  expect(terminalAgentActivity("codex", "Codex", [])).toBe("idle");
  expect(terminalAgentActivity("codex", "Action Required", [])).toBe("needs_input");
  expect(terminalAgentActivity("codex", "Action Required ⠋", [])).toBe("needs_input");
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
