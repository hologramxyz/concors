import { useEffect, type ComponentProps, type ReactElement, type RefObject } from "react";
import type { AgentInfo, PaneProfile, WorkspaceTab } from "@concors/protocol";
import { Terminal } from "lucide-react";
import { AgentStatusIcon, StartingChatIcon } from "@/agents/activity";
import { ProviderIcon } from "@/agents/provider-icon";
import {
  isActiveStatus,
  mostUrgentPane,
  paneAgentStatus,
  tabAgentStatuses,
} from "@/agents/agent-status";
import { useAgents } from "@/agents/context";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { useFocusedPane } from "./focused-panes";
import { mainPane, tabTitle } from "./tab-title";
import { SidebarTooltip } from "@/components/sidebar-tooltip";

/**
 * A tab's label: one icon, then its name, then how many panes it has if more than one. The icon is
 * the status of the pane that most wants a look. With nothing pending it is the focused pane's, or
 * until a tab has been shown its main pane's: a chat by the provider it starts with, an agent CLI by
 * its brand, and a terminal by the terminal mark, so every tab carries one. It subscribes to agent
 * and terminal updates itself so a status change repaints the label, not the workspace.
 */
export function TabButton({
  tab,
  selected,
  ...props
}: { tab: WorkspaceTab; selected: boolean } & ComponentProps<"button">) {
  const sessions = useAgents();
  const terminals = useTerminalSessions();
  const agents = tabAgentStatuses(tab, sessions, terminals);
  const focusedPaneId = useFocusedPane(tab.id);
  const pane =
    mostUrgentPane(tab, sessions, terminals, focusedPaneId) ??
    tab.nodes.find(
      (node): node is Extract<typeof node, { kind: "pane" }> =>
        node.kind === "pane" && node.id === focusedPaneId,
    ) ??
    mainPane(tab);
  const status = pane ? paneAgentStatus(pane, sessions, terminals) : null;
  const paneCount = tab.nodes.filter((node) => node.kind === "pane").length;
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
      <span
        aria-hidden="true"
        data-tab-icon-for={pane?.id}
        className="flex size-5 shrink-0 items-center justify-center"
      >
        {status ? (
          <AgentStatusIcon
            agent={status}
            label={`${status.providerName}: ${status.status}`}
            surface={selected ? "bg-background ring-background" : "bg-sidebar ring-sidebar"}
          />
        ) : (
          <PaneMark profile={pane?.profile} />
        )}
      </span>
      <span className="max-w-44 truncate">{tabTitle(tab, sessions, terminals)}</span>
      {paneCount > 1 && (
        <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {paneCount}
        </span>
      )}
    </button>
  );
}

function PaneMark({ profile }: { profile: PaneProfile | undefined }) {
  if (profile === "chat") return <StartingChatIcon />;
  if (profile === "codex" || profile === "claude" || profile === "opencode")
    return <ProviderIcon provider={profile} />;
  return <Terminal className="size-4 text-muted-foreground" />;
}

/**
 * A tab's tooltip: how many panes it has and the agents in it that are busy, waiting or failed.
 * With nothing to say, there is no tooltip.
 */
export function TabTooltip({ tab, children }: { tab: WorkspaceTab; children: ReactElement }) {
  const agents = tabAgentStatuses(tab, useAgents(), useTerminalSessions()).filter(isActiveStatus);
  const paneCount = tab.nodes.filter((node) => node.kind === "pane").length;
  const content =
    paneCount > 1 || agents.length ? (
      <div className="flex flex-col gap-1 pr-1.5">
        {paneCount > 1 && <p>{paneCount} panes</p>}
        {agents.map((agent) => (
          <p key={agent.id}>{`${agent.providerName}: ${agent.status}`}</p>
        ))}
      </div>
    ) : null;
  return (
    <SidebarTooltip place="title-bar" content={content}>
      {children}
    </SidebarTooltip>
  );
}

export function CloseTabButton({
  tab,
  ...props
}: { tab: WorkspaceTab } & ComponentProps<"button">) {
  const label = tabTitle(tab, useAgents(), useTerminalSessions());
  return (
    <SidebarTooltip place="title-bar" content="Close tab" shortcut="close-tab">
      <button type="button" aria-label={`Close ${label} tab`} {...props} />
    </SidebarTooltip>
  );
}

/** Keeps the latest agents in `targetRef` for event handlers, without repainting the tab bar. */
export function LatestAgents({ targetRef }: { targetRef: RefObject<readonly AgentInfo[]> }) {
  const agents = useAgents();
  useEffect(() => {
    targetRef.current = agents;
  }, [agents, targetRef]);
  return null;
}
