import type { AgentPending } from "@concors/protocol";
import { approvalParts } from "@/agents/approval-summary";
import { commandSummary } from "@/agents/tool-label";
import { shortPath } from "@/agents/short-path";

/**
 * The question "Ask Supervisor" drafts about a chat's pending request, for the person to send.
 * It names the request as the chat shows it: a command without the `cd <folder> &&` agents put in
 * front of it, a file by the shortened path the approval card shows (from the chat's folder or its
 * workspace's, else with "~" for home). Cut at 120 characters; the request itself has the rest.
 */
export function askQuestion(
  label: string,
  pending: AgentPending,
  /** The chat's own folder first, then its workspace's, which the approval card shortens from. */
  roots: readonly string[],
  home: (path: string) => string,
): string {
  const { lead, tool, target, path } = approvalParts(pending);
  const file = (value: string) => {
    const relative = shortPath(value, roots, null);
    return relative === value ? home(value) : relative;
  };
  const action = (
    tool && target ? `${tool} ${path ? file(target) : target}` : commandSummary(lead).split("\n")[0]
  )?.slice(0, 120);
  return action
    ? `Should I approve @${label}’s request “${action}”?`
    : `What should I do about @${label}’s pending request?`;
}
