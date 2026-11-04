import {
  isDefaultTabName,
  UNTITLED_CHAT_NAME,
  type AgentInfo,
  type LayoutNode,
  type PaneProfile,
  type TerminalInfo,
  type WorkspaceTab,
} from "@concors/protocol";

type Pane = Extract<LayoutNode, { kind: "pane" }>;
type Agents = readonly Pick<AgentInfo, "id" | "name">[];
type Terminals = readonly Pick<TerminalInfo, "id" | "status" | "foregroundCommand">[];

export const PROFILE_LABELS: Record<PaneProfile, string> = {
  shell: "Terminal",
  chat: "Agent",
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
};

/**
 * What a pane is called when nobody named it: its chat's title, or what runs in it. A shell running
 * a command is called by the command, as it is once its tab is closed and it runs in the background.
 */
export function defaultPaneTitle(pane: Pane, agents: Agents, terminals: Terminals = []) {
  if (pane.profile === "chat")
    return agents.find((agent) => agent.id === pane.sessionId)?.name ?? UNTITLED_CHAT_NAME;
  const terminal =
    pane.profile === "shell" ? terminals.find((item) => item.id === pane.sessionId) : undefined;
  const command = terminal?.status === "running" ? terminal.foregroundCommand : null;
  return command || (pane.terminalProfile?.name ?? PROFILE_LABELS[pane.profile]);
}

export function paneTitle(pane: Pane, agents: Agents, terminals: Terminals = []) {
  return pane.name ?? defaultPaneTitle(pane, agents, terminals);
}

/**
 * The pane a split tab is named after: its oldest. The layout's first pane would rename the tab
 * whenever panes are rearranged, and a move leaves the order of the nodes alone. No daemon stores
 * this, so every client and reload works it out the same way.
 */
export function mainPane(tab: WorkspaceTab): Pane | undefined {
  return tab.nodes.find((node): node is Pane => node.kind === "pane");
}

/** A tab the user has not named shows its main pane's title instead of "Tab N". */
export function tabTitle(tab: WorkspaceTab, agents: Agents, terminals: Terminals = []) {
  if (!isDefaultTabName(tab.name)) return tab.name;
  const pane = mainPane(tab);
  return pane ? paneTitle(pane, agents, terminals) : tab.name;
}
