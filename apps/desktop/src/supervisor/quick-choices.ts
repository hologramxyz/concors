import type { AgentPending } from "@concors/protocol";

export interface QuickChoice {
  decision: "accept" | "decline";
  actionId?: string;
  label: string;
}

/** Choices that last beyond this request: for the session, always, or as a rule. */
const LASTING = /always|session|rule|policy|amend|forever|permanent/i;
const ONCE = /(?:^|[^a-z])once(?:$|[^a-z])/i;

/**
 * The two answers worth giving away from the chat: allow this once, or decline it. Only a choice
 * that is plainly for this request alone qualifies, never one that lasts (for the session, always,
 * a rule), whatever order a harness lists them in. A plan, a mode change, a question, or a request
 * offering no such pair is answered in the chat, where all of it can be read.
 */
export function quickChoices(
  pending: AgentPending,
): { allow: QuickChoice; decline: QuickChoice } | null {
  if (pending.kind !== "approval") return null;
  if (pending.plan !== undefined || (pending.approvalKind && pending.approvalKind !== "tool"))
    return null;
  if (pending.actions) {
    const lasting = (a: { id: string; label: string }) => LASTING.test(`${a.id} ${a.label}`);
    const accepts = pending.actions.filter((a) => a.decision === "accept");
    // Codex names allowing once "accept"; other harnesses say "once" in its ID or label.
    const allow =
      accepts.find((a) => a.id === "accept") ??
      accepts.find((a) => !lasting(a) && ONCE.test(`${a.id} ${a.label}`));
    const decline =
      pending.actions.find((a) => a.decision === "decline" && a.id === "decline") ??
      pending.actions.find((a) => a.decision === "decline" && !lasting(a));
    return allow && !lasting(allow) && decline
      ? {
          allow: { decision: "accept", actionId: allow.id, label: allow.label },
          decline: { decision: "decline", actionId: decline.id, label: decline.label },
        }
      : null;
  }
  return pending.decisions.includes("accept") && pending.decisions.includes("decline")
    ? {
        allow: { decision: "accept", label: pending.decisionLabels?.accept ?? "Allow once" },
        decline: { decision: "decline", label: pending.decisionLabels?.decline ?? "Decline" },
      }
    : null;
}
