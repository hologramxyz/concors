import { useEffect, type ComponentProps, type RefObject } from "react";
import type { AgentInfo, WorkspaceTab } from "@concors/protocol";
import { AgentStatusIcon } from "@/agents/activity";
import { tabAgentStatuses } from "@/agents/agent-status";
import { useAgents } from "@/agents/context";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { tabTitle } from "./tab-title";

/**
 * A tab's label: the provider and status of every agent in its panes, then its name. It subscribes
 * to agent and terminal updates itself so a status change repaints the label, not the workspace.
 */
export function TabButton({
  tab,
  selected,
  ...props
}: { tab: WorkspaceTab; selected: boolean } & ComponentProps<"button">) {
  const sessions = useAgents();
  const agents = tabAgentStatuses(tab, sessions, useTerminalSessions());
  return (
    <button
      type="button"
      aria-pressed={selected}
      // Screen readers get the statuses here, so the button's name stays the tab name.
      aria-description={
        agents.length
          ? agents.map((agent) => `${agent.providerName}: ${agent.status}`).join(", ")
          : undefined
      }
      className="flex max-w-72 min-w-0 items-center gap-1.5 px-2 py-0.5 text-ui"
      {...props}
    >
      {agents.length > 0 && (
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
          {agents.map((agent) => (
            <span key={agent.id} title={`${agent.providerName} · ${agent.status}`} className="flex">
              <AgentStatusIcon
                agent={agent}
                label={`${agent.providerName}: ${agent.status}`}
                surface={selected ? "bg-background ring-background" : "bg-sidebar ring-sidebar"}
              />
            </span>
          ))}
        </span>
      )}
      <span className="max-w-44 truncate">{tabTitle(tab, sessions)}</span>
    </button>
  );
}

export function CloseTabButton({
  tab,
  ...props
}: { tab: WorkspaceTab } & ComponentProps<"button">) {
  return <button type="button" aria-label={`Close ${tabTitle(tab, useAgents())} tab`} {...props} />;
}

/** Keeps the latest agents in `targetRef` for event handlers, without repainting the tab bar. */
export function LatestAgents({ targetRef }: { targetRef: RefObject<readonly AgentInfo[]> }) {
  const agents = useAgents();
  useEffect(() => {
    targetRef.current = agents;
  }, [agents, targetRef]);
  return null;
}
