import type { ActivityResponse, AgentInfo, AgentPending, TerminalInfo } from "@concors/protocol";

type AgentState = Pick<AgentInfo, "status"> & {
  readonly pending: readonly Pick<AgentPending, "asynchronous">[];
};
type TerminalState = Pick<TerminalInfo, "status" | "agentActivity">;

/**
 * Whether installing a new daemon now would interrupt someone. The control plane asks before an
 * automatic update, because installing restarts the session host and ends every running agent.
 *
 * Only work a restart would cut short counts. A chat that is open but idle, finished or failed is
 * not busy: its conversation resumes after the restart. Neither is a question an agent asked
 * without stopping (Codex's asynchronous questions): it survives a restart, and counting it would
 * hold updates back for as long as nobody dismissed it. A terminal counts only while its process is
 * running, since a stored session keeps the last activity it reported.
 */
export function machineActivity(
  agents: readonly AgentState[],
  terminals: readonly TerminalState[],
): ActivityResponse {
  let working = 0;
  let waiting = 0;
  for (const agent of agents) {
    if (agent.status === "needs_input" || agent.pending.some((pending) => !pending.asynchronous))
      waiting++;
    else if (agent.status === "starting" || agent.status === "working") working++;
  }
  for (const terminal of terminals) {
    if (terminal.status !== "running" && terminal.status !== "starting") continue;
    if (terminal.agentActivity === "working") working++;
    else if (terminal.agentActivity === "needs_input") waiting++;
  }
  return { busy: working + waiting > 0, agents: { working, waiting } };
}
