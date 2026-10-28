import {
  isDefaultTabName,
  UNTITLED_CHAT_NAME,
  type AgentInfo,
  type LayoutNode,
  type PaneProfile,
  type WorkspaceTab,
} from "@concors/protocol";

type Pane = Extract<LayoutNode, { kind: "pane" }>;

export const PROFILE_LABELS: Record<PaneProfile, string> = {
  shell: "Terminal",
  chat: "Agent",
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
};

/** What a pane is called when nobody named it: its chat's title, or what runs in it. */
export function defaultPaneTitle(pane: Pane, agents: readonly Pick<AgentInfo, "id" | "name">[]) {
  if (pane.profile === "chat")
    return agents.find((agent) => agent.id === pane.sessionId)?.name ?? UNTITLED_CHAT_NAME;
  return pane.terminalProfile?.name ?? PROFILE_LABELS[pane.profile];
}

export function paneTitle(pane: Pane, agents: readonly Pick<AgentInfo, "id" | "name">[]) {
  return pane.name ?? defaultPaneTitle(pane, agents);
}

/** The pane a split tab is named after: the first one in its layout. */
export function mainPane(tab: WorkspaceTab): Pane | undefined {
  let node = tab.nodes.find((item) => item.id === tab.root);
  while (node?.kind === "split") {
    const first = node.first;
    node = tab.nodes.find((item) => item.id === first);
  }
  return node?.kind === "pane" ? node : undefined;
}

/** A tab the user has not named shows its main pane's title instead of "Tab N". */
export function tabTitle(tab: WorkspaceTab, agents: readonly Pick<AgentInfo, "id" | "name">[]) {
  if (!isDefaultTabName(tab.name)) return tab.name;
  const pane = mainPane(tab);
  return pane ? paneTitle(pane, agents) : tab.name;
}
