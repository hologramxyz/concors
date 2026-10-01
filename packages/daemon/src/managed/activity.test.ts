import type { AgentInfo, TerminalInfo } from "@concors/protocol";
import { describe, expect, it } from "vitest";

import { machineActivity } from "./activity.ts";

const chat = (status: AgentInfo["status"], pending: { asynchronous?: boolean }[] = []) => ({
  status,
  pending,
});
const terminal = (
  agentActivity: TerminalInfo["agentActivity"],
  status: TerminalInfo["status"] = "running",
) => ({ status, agentActivity });

describe("machineActivity", () => {
  it("is idle with nothing open", () => {
    expect(machineActivity([], [])).toEqual({ busy: false, agents: { working: 0, waiting: 0 } });
  });

  it("does not count chats a restart would not interrupt", () => {
    expect(
      machineActivity(
        ["idle", "done", "failed", "interrupted"].map((status) =>
          chat(status as AgentInfo["status"]),
        ),
        [],
      ),
    ).toEqual({ busy: false, agents: { working: 0, waiting: 0 } });
  });

  it("counts starting and working chats as working", () => {
    expect(machineActivity([chat("starting"), chat("working"), chat("idle")], [])).toEqual({
      busy: true,
      agents: { working: 2, waiting: 0 },
    });
  });

  it("counts chats waiting for an answer or an approval once each", () => {
    expect(
      machineActivity(
        [
          chat("needs_input"),
          chat("needs_input", [{}]),
          // Mid-turn with a pending approval: waiting, not also working.
          chat("working", [{ asynchronous: false }]),
          chat("idle", [{}]),
        ],
        [],
      ),
    ).toEqual({ busy: true, agents: { working: 0, waiting: 4 } });
  });

  it("ignores questions asked without stopping, which survive a restart", () => {
    expect(machineActivity([chat("idle", [{ asynchronous: true }])], [])).toEqual({
      busy: false,
      agents: { working: 0, waiting: 0 },
    });
    expect(machineActivity([chat("working", [{ asynchronous: true }])], [])).toEqual({
      busy: true,
      agents: { working: 1, waiting: 0 },
    });
  });

  it("counts terminal agents by their activity while their process runs", () => {
    expect(
      machineActivity(
        [],
        [
          terminal("working"),
          terminal("working", "starting"),
          terminal("needs_input"),
          terminal("idle"),
          terminal("unknown"),
          terminal(undefined),
        ],
      ),
    ).toEqual({ busy: true, agents: { working: 2, waiting: 1 } });
  });

  it("ignores the last activity of terminals that are no longer running", () => {
    expect(
      machineActivity(
        [],
        [
          terminal("working", "exited"),
          terminal("working", "interrupted"),
          terminal("needs_input", "failed"),
        ],
      ),
    ).toEqual({ busy: false, agents: { working: 0, waiting: 0 } });
  });

  it("adds chats and terminals together", () => {
    expect(
      machineActivity(
        [chat("working"), chat("needs_input"), chat("idle")],
        [terminal("working"), terminal("needs_input"), terminal("idle")],
      ),
    ).toEqual({ busy: true, agents: { working: 2, waiting: 2 } });
  });
});
