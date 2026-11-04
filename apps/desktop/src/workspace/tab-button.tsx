import { useEffect, type ComponentProps, type RefObject } from "react";
import type { AgentInfo, PaneProfile, WorkspaceTab } from "@concors/protocol";
import { Terminal } from "lucide-react";
import { AgentStatusIcon, StartingChatIcon } from "@/agents/activity";
import { ProviderIcon } from "@/agents/provider-icon";
import { paneAgentStatus, tabAgentStatuses } from "@/agents/agent-status";
import { useAgents } from "@/agents/context";
import type { CommandId } from "@/shortcuts/bindings";
import { BoundKeyChips } from "@/shortcuts/key-chips";
import { mainBinding } from "@/shortcuts/keymap";
import { useShortcutPreferences } from "@/shortcuts/preferences-context";
import { isTauri } from "@/tauri";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { useFocusedPane } from "./focused-panes";
import { mainPane, tabTitle } from "./tab-title";
import { SidebarTooltip } from "@/components/sidebar-tooltip";

/**
 * A tab's label: one icon, then its name, then how many panes it has if more than one. The icon is
 * the focused pane's, or until a tab has been shown its main pane's: the agent's provider and
 * status, a chat by the provider it starts with, an agent CLI by its brand, and a terminal by the
 * terminal mark, so every tab carries one. The other panes' agents are in the tooltip. It subscribes
 * to agent and terminal updates itself so a status change repaints the label, not the workspace.
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
    tab.nodes.find(
      (node): node is Extract<typeof node, { kind: "pane" }> =>
        node.kind === "pane" && node.id === focusedPaneId,
    ) ?? mainPane(tab);
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

const TAB_SHORTCUTS: readonly { id: CommandId; label: string }[] = [
  { id: "rename-tab", label: "Rename" },
  { id: "move-tab-left", label: "Move left" },
  { id: "move-tab-right", label: "Move right" },
];

/** What a tab in the tab bar can do beyond a click. An unassigned shortcut gets no row. */
export function TabTooltip({ tab }: { tab: WorkspaceTab }) {
  const { keymap } = useShortcutPreferences();
  const agents = tabAgentStatuses(tab, useAgents(), useTerminalSessions());
  const paneCount = tab.nodes.filter((node) => node.kind === "pane").length;
  return (
    <div className="flex flex-col gap-1 pr-1.5">
      {paneCount > 1 && <p>{paneCount} panes</p>}
      {agents.map((agent) => (
        <p key={agent.id}>{`${agent.providerName}: ${agent.status}`}</p>
      ))}
      <p>Drag to reorder. Double-click to rename.</p>
      {TAB_SHORTCUTS.filter(({ id }) => mainBinding(keymap[id], isTauri())).map(({ id, label }) => (
        <p key={id} className="flex items-center justify-between gap-3">
          {label}
          <BoundKeyChips id={id} />
        </p>
      ))}
    </div>
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
