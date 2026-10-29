import { createContext } from "react";
import {
  agentProviderName,
  isDefaultTabName,
  type TerminalInfo,
  type WorkspaceSnapshot,
  type WorkspaceTab,
} from "@concors/protocol";
import { mainPane } from "@/workspace/tab-title";

/** Sessions some pane shows. Any other terminal still running has had its tab closed. */
export function shownSessions(workspace: Pick<WorkspaceSnapshot, "projects"> | null) {
  const shown = new Set<string>();
  for (const project of workspace?.projects ?? [])
    for (const tab of project.tabs)
      for (const node of tab.nodes)
        if (node.kind === "pane" && node.sessionId) shown.add(node.sessionId);
  return shown;
}

/**
 * What a running terminal is busy with, or null for a shell waiting at a prompt: a coding agent by
 * name, otherwise the foreground command as the daemon labels it.
 */
export function terminalActivity(terminal: TerminalInfo): string | null {
  if (terminal.status !== "running" && terminal.status !== "starting") return null;
  if (terminal.profile !== "shell") return agentProviderName(terminal.profile);
  if (terminal.detectedAgent) return agentProviderName(terminal.detectedAgent);
  return terminal.foregroundCommand ?? null;
}

/** Whether a terminal is known to wait at a prompt. Daemons that cannot tell never say so. */
export function isIdleShell(terminal: TerminalInfo) {
  return (
    terminal.profile === "shell" &&
    !terminal.detectedAgent &&
    terminal.foregroundCommand === null &&
    (terminal.status === "running" || terminal.status === "starting")
  );
}

/**
 * Terminals whose tab was closed while they kept running something, newest first. A shell waiting
 * at a prompt has nothing to come back to, so it is left out.
 */
export function backgroundTerminals(
  workspace: Pick<WorkspaceSnapshot, "projects"> | null,
  terminals: readonly TerminalInfo[],
): TerminalInfo[] {
  const shown = shownSessions(workspace);
  const projects = new Set(workspace?.projects.map((project) => project.id));
  return terminals
    .filter(
      (terminal) =>
        projects.has(terminal.projectId) && !shown.has(terminal.id) && terminalActivity(terminal),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The running terminals a tab, or one of its panes, shows; closing it sends them to the background. */
export function closingTerminals(
  tab: WorkspaceTab | undefined,
  terminals: readonly TerminalInfo[],
  paneId?: string,
): TerminalInfo[] {
  const sessions = new Set(
    tab?.nodes.flatMap((node) =>
      node.kind === "pane" &&
      node.profile !== "chat" &&
      node.sessionId &&
      (!paneId || node.id === paneId)
        ? [node.sessionId]
        : [],
    ),
  );
  return terminals.filter(
    (terminal) =>
      sessions.has(terminal.id) &&
      (terminal.status === "running" || terminal.status === "starting"),
  );
}

/**
 * What the user called the terminals a close is about to send to the background: a pane's own name,
 * or its tab's for the tab's main pane. Terminals nobody named are left out and keep being called by
 * what they run.
 */
export function closingNames(tab: WorkspaceTab | undefined, paneId?: string): Map<string, string> {
  const names = new Map<string, string>();
  if (!tab) return names;
  const main = mainPane(tab);
  for (const node of tab.nodes) {
    if (node.kind !== "pane" || node.profile === "chat" || !node.sessionId) continue;
    if (paneId && node.id !== paneId) continue;
    const name =
      node.name ?? (node.id === main?.id && !isDefaultTabName(tab.name) ? tab.name : undefined);
    if (name) names.set(node.sessionId, name);
  }
  return names;
}

/** Reopening and stopping a background terminal, wherever it is listed. */
export interface BackgroundTerminalActions {
  reopen: (terminal: TerminalInfo) => void;
  stop: (terminal: TerminalInfo) => void;
  /** Opens the list of every background terminal, to free one up at the limit. */
  manage: () => void;
}
export const BackgroundTerminalsContext = createContext<BackgroundTerminalActions | null>(null);
