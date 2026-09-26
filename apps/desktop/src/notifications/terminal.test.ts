import { expect, it } from "vitest";
import type { TerminalInfo } from "@concors/protocol";
import { terminalAgentSound } from "./terminal";
const session = (
  agentActivity: TerminalInfo["agentActivity"],
  agentTurnCompleted = false,
): TerminalInfo => ({
  id: "4d8bfb1e-9b0b-4f69-9a52-3f7a8b0c2e11",
  projectId: "0e1c3f5a-8d2b-4a3e-9f61-7b2c4d5e6f70",
  profile: "shell",
  detectedAgent: "claude",
  directory: "/repo",
  status: "running",
  exitCode: null,
  error: null,
  startedAt: "2026-09-26T00:00:00.000Z",
  cols: 80,
  rows: 24,
  agentActivity,
  agentTurnCompleted,
});

it("plays completion only for a finished turn in a terminal the user is not viewing", () => {
  expect(terminalAgentSound(session("working"), session("idle", true), false)).toBe("done");
  expect(terminalAgentSound(session("needs_input"), session("idle", true), false)).toBe("done");
  expect(terminalAgentSound(session("working"), session("idle", true), true)).toBeNull();
  expect(terminalAgentSound(session("working"), session("idle", false), false)).toBeNull();
});

it("plays requests for input even in the focused terminal", () => {
  expect(terminalAgentSound(session("working"), session("needs_input"), true)).toBe("needs_input");
  expect(terminalAgentSound(session("idle"), session("needs_input"), false)).toBe("needs_input");
});

it("stays silent for first sightings, repeats, newly detected agents, and exited sessions", () => {
  expect(terminalAgentSound(undefined, session("needs_input"), false)).toBeNull();
  expect(terminalAgentSound(session("needs_input"), session("needs_input"), false)).toBeNull();
  expect(terminalAgentSound(session("unknown"), session("needs_input"), false)).toBeNull();
  expect(terminalAgentSound(session("idle", true), session("working"), false)).toBeNull();
  expect(
    terminalAgentSound(
      session("working"),
      { ...session("idle", true), status: "exited", exitCode: 0 },
      false,
    ),
  ).toBeNull();
});
