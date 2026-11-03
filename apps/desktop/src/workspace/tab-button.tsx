import { useEffect, type ComponentProps, type RefObject } from "react";
import type { AgentInfo, PaneProfile, WorkspaceTab } from "@concors/protocol";
import { Terminal } from "lucide-react";
import { AgentStatusIcon, StartingChatIcon } from "@/agents/activity";
import { ProviderIcon } from "@/agents/provider-icon";
import { tabAgentStatuses } from "@/agents/agent-status";
import { useAgents } from "@/agents/context";
import type { CommandId } from "@/shortcuts/bindings";
import { BoundKeyChips } from "@/shortcuts/key-chips";
import { mainBinding } from "@/shortcuts/keymap";
import { useShortcutPreferences } from "@/shortcuts/preferences-context";
import { isTauri } from "@/tauri";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { mainPane, tabTitle } from "./tab-title";
import { SidebarTooltip } from "@/components/sidebar-tooltip";

/**
 * A tab's label: the provider and status of every agent in its panes, then its name. A tab with no
 * agent running is marked by its main pane: a chat by the provider it starts with, an agent CLI by
 * its brand, and a terminal by the terminal mark, so every tab carries one. It subscribes
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
      {agents.length === 0 && (
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
          <PaneMark profile={mainPane(tab)?.profile} />
        </span>
      )}
      {agents.length > 0 && (
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
          {agents.map((agent) => (
            <span key={agent.id} title={`${agent.providerName}: ${agent.status}`} className="flex">
              <AgentStatusIcon
                agent={agent}
                label={`${agent.providerName}: ${agent.status}`}
                surface={selected ? "bg-background ring-background" : "bg-sidebar ring-sidebar"}
              />
            </span>
          ))}
        </span>
      )}
      <span className="max-w-44 truncate">{tabTitle(tab, sessions, terminals)}</span>
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
export function TabTooltip() {
  const { keymap } = useShortcutPreferences();
  return (
    <div className="flex flex-col gap-1 pr-1.5">
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
