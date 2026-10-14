import { agentProviderName, type AgentInfo } from "@concors/protocol";

/**
 * A chat pane keeps one conversation per provider. A conversation cannot move from one CLI to
 * another, so switching to another provider's model sets the current one aside and shows that
 * provider's earlier conversation in the pane, or starts a new one; switching back returns to it.
 * Nothing is deleted, but a long chat that vanishes looks deleted, so the app says so before and
 * after the switch.
 */
export function setAsideConversation(
  agents: readonly AgentInfo[],
  agent: AgentInfo,
  provider: string,
): AgentInfo | undefined {
  const group = agent.providerGroupId ?? agent.id;
  return agents.find(
    (other) =>
      other.id !== agent.id &&
      other.provider === provider &&
      (other.providerGroupId ?? other.id) === group &&
      other.projectId === agent.projectId &&
      other.directory === agent.directory &&
      !!other.threadId,
  );
}

/** Whether the agent's conversation has anything in it: a turn ever ran, or it was imported. */
export function hasConversation(agent: AgentInfo): boolean {
  return !!agent.turnStartedAt || !!agent.nativeImport;
}

/** How the provider list describes choosing a provider for this pane. */
export function switchDescription(
  agents: readonly AgentInfo[],
  agent: AgentInfo,
  provider: string,
): string {
  if (provider === agent.provider) return "Current conversation";
  return setAsideConversation(agents, agent, provider)
    ? "Back to its conversation in this pane"
    : "Starts a new conversation in this pane";
}

/** The confirmation shown before a switch would set a conversation with content aside. */
export function switchConfirmation(
  agents: readonly AgentInfo[],
  agent: AgentInfo,
  provider: string,
  providerLabel: string,
): { title: string; description: string; action: string } {
  const current = agent.providerLabel ?? agentProviderName(agent.provider);
  const kept = `Your ${current} conversation is kept: switch back to ${current} to return to it.`;
  return setAsideConversation(agents, agent, provider)
    ? {
        title: `Switch to ${providerLabel}?`,
        description: `This pane goes back to your earlier ${providerLabel} conversation. ${kept}`,
        action: `Switch to ${providerLabel}`,
      }
    : {
        title: `Start a new ${providerLabel} conversation?`,
        description: `${providerLabel} can't continue this ${current} conversation, so this pane starts a new one. ${kept}`,
        action: "Start new conversation",
      };
}
