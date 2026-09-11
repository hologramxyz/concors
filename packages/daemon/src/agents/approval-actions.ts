import { z } from "zod";
import type { AgentPending } from "@concors/protocol";
const Action = z.object({
  id: z.string().min(1).max(512),
  label: z.string().min(1).max(100),
  decision: z.enum(["accept", "decline", "cancel"]),
});
/** Keep native choices intact; never turn an explicit persistent grant into an Allow once button. */
export function approvalActions(params: Record<string, unknown>) {
  const values = new Map<string, unknown>();
  let actions: NonNullable<AgentPending["actions"]>;
  if (params["actions"]) actions = z.array(Action).min(1).max(32).parse(params["actions"]);
  else if (Array.isArray(params["availableDecisions"])) {
    actions = params["availableDecisions"].slice(0, 32).flatMap((entry, index) => {
      const id = typeof entry === "string" ? entry : `native:${index}`;
      let label: string, decision: "accept" | "decline" | "cancel";
      if (entry === "accept") {
        label = "Allow once";
        decision = "accept";
      } else if (entry === "acceptForSession") {
        label = "Allow for this session";
        decision = "accept";
      } else if (entry === "decline") {
        label = "Decline";
        decision = "decline";
      } else if (entry === "cancel") {
        label = "Cancel turn";
        decision = "cancel";
      } else if (entry && typeof entry === "object" && "acceptWithExecpolicyAmendment" in entry) {
        label = "Approve command rule";
        decision = "accept";
      } else if (entry && typeof entry === "object" && "applyNetworkPolicyAmendment" in entry) {
        label = "Apply network rule";
        decision = "accept";
      } else return [];
      values.set(id, entry);
      return [{ id, label, decision }];
    });
  } else
    actions = [
      { id: "accept", label: "Allow once", decision: "accept" },
      { id: "decline", label: "Decline", decision: "decline" },
      { id: "cancel", label: "Cancel turn", decision: "cancel" },
    ];
  if (new Set(actions.map((a) => a.id)).size !== actions.length)
    throw new Error("Duplicate permission action IDs");
  return { actions, values };
}
