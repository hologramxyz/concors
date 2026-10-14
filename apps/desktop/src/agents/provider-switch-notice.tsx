import { agentProviderName, type AgentInfo } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { useAgents } from "./context";
import { hasConversation } from "./provider-switch";
import { useAgentModelSelection } from "./use-model-selection";

const ignore = () => undefined;

/**
 * Shown in a pane's new, empty conversation after switching provider: the conversation it replaced
 * is kept, and one click returns to it. Without this, a long chat that vanished looked deleted.
 */
export function ProviderSwitchNotice({ agent, disabled }: { agent: AgentInfo; disabled: boolean }) {
  const agents = useAgents();
  const { choose, switching, error } = useAgentModelSelection(agent, ignore, false);
  const group = agent.providerGroupId;
  const previous = group
    ? agents
        .filter(
          (other) =>
            other.id !== agent.id &&
            other.provider !== agent.provider &&
            (other.providerGroupId ?? other.id) === group &&
            other.projectId === agent.projectId &&
            other.directory === agent.directory &&
            !!other.threadId &&
            hasConversation(other),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    : undefined;
  if (!previous) return null;
  const current = agent.providerLabel ?? agentProviderName(agent.provider);
  const earlier = previous.providerLabel ?? agentProviderName(previous.provider);
  return (
    <div role="status" className="flex flex-col items-center gap-2 py-6 text-center text-sm">
      <p className="text-muted-foreground">
        New {current} conversation. Your {earlier} conversation is kept.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || switching}
        onClick={() => void choose("", previous.provider)}
      >
        {switching ? "Switching…" : `Back to ${earlier}`}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
