import { createContext } from "react";
import type { AgentItem } from "@concors/protocol";

/** A sub-agent to show: the tool call that started it, and which of its children. */
export interface SubAgentTarget {
  /** The call as it was when opened; the chat's own copy, kept current, is preferred. */
  item: AgentItem;
  childId: string;
  /** Its position among the call's sub-agents, when there are several. */
  index?: number | undefined;
}

/**
 * Opens a sub-agent's conversation beside the chat that started it. Null where none can be opened:
 * a provider that keeps no child history, or inside a sub-agent's own conversation, whose nested
 * sub-agents its parent chat cannot address.
 */
export const SubAgentViewContext = createContext<((target: SubAgentTarget) => void) | null>(null);

/** Statuses a sub-agent reports while it still works. */
export const LIVE_SUB_AGENT = ["running", "pending", "pendingInit", "inProgress"];
