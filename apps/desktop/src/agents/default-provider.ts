import { useContext } from "react";
import type { AgentInfo } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useAgents } from "./context";
import { hasConversation } from "./provider-switch";
import { knownProviders } from "./session-cache";

/**
 * The provider a new chat starts with: the one whose chat last had a turn, then the first
 * installed one. Null when nothing is installed, so the chat asks instead.
 */
export function defaultProvider(
  installed: readonly string[],
  agents: readonly AgentInfo[],
): string | null {
  const last = agents
    .filter((agent) => installed.includes(agent.provider) && hasConversation(agent))
    .reduce<AgentInfo | undefined>(
      (latest, agent) =>
        !latest || lastUsed(agent).localeCompare(lastUsed(latest)) > 0 ? agent : latest,
      undefined,
    );
  return last?.provider ?? installed[0] ?? null;
}

function lastUsed(agent: AgentInfo) {
  return agent.turnStartedAt ?? agent.updatedAt;
}

/** The provider a chat that has not started yet will start with, once the machine listed them. */
export function useStartingProvider(): string | null {
  const connection = useContext(TerminalConnectionContext);
  const agents = useAgents();
  const known = connection ? knownProviders.get(connection) : undefined;
  return known
    ? defaultProvider(
        known.providers.map((p) => p.id),
        agents,
      )
    : null;
}
