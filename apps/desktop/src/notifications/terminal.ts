import type { TerminalInfo } from "@concors/protocol";
import type { Notice } from "./engine";

/**
 * Agent CLIs in a terminal have no daemon attention records, so their sounds follow Herdr's
 * `notification_sound_for_state_change` on the daemon's detected activity instead: a request for
 * input always sounds, a finished turn only when that terminal is not in front of the user.
 * First sightings (snapshots, newly detected agents) stay silent.
 */
export function terminalAgentSound(
  previous: TerminalInfo | undefined,
  next: TerminalInfo,
  focused: boolean,
): Notice["kind"] | null {
  const before = previous?.agentActivity ?? "unknown";
  const after = next.agentActivity ?? "unknown";
  if (!previous || before === after || before === "unknown" || next.status !== "running")
    return null;
  if (after === "needs_input") return "needs_input";
  if (after === "idle" && next.agentTurnCompleted && !focused) return "done";
  return null;
}
