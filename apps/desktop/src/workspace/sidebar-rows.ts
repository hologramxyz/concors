import { useEffect, useState } from "react";
import type { AgentInfo, TerminalInfo, WorkspaceSnapshot } from "@concors/protocol";
import {
  chatAgentStatus,
  isLiveTerminalAgent,
  terminalAgentStatus,
  type AgentStatus,
} from "@/agents/agent-status";
import { agentDisplayStatus } from "@/agents/context";
import { closedChats, type ClosedChat } from "@/agents/closed-chats";
import { backgroundTerminals, terminalActivity } from "@/terminal/background-terminals";
import { mainPane, tabTitle } from "./tab-title";
import { tabPanes, type PaneNode } from "./tab-panes";

/** An open tab, named and iconned after its main pane, so a split tab is one row. */
export interface OpenTabRow {
  readonly kind: "tab";
  readonly key: string;
  readonly projectId: string;
  readonly tabId: string;
  readonly title: string;
  /** The chat its main pane shows, once that chat has started. */
  readonly chat?: AgentInfo | undefined;
  /** The terminal its main pane runs, once it has started. */
  readonly terminal?: TerminalInfo | undefined;
  /** What runs in the main pane when it is a terminal: a coding agent's CLI, or a shell. */
  readonly tool: "chat" | "codex" | "claude" | "opencode" | "shell";
  readonly time: string;
}

/** A chat no pane shows any more; it comes back in a tab of its workspace. */
export interface ClosedChatRow {
  readonly kind: "closed";
  readonly key: string;
  readonly projectId: string;
  readonly chat: ClosedChat;
  readonly time: string;
}

/** A terminal whose tab closed while it kept running something; it comes back into a new tab. */
export interface BackgroundTerminalRow {
  readonly kind: "terminal";
  readonly key: string;
  readonly projectId: string;
  readonly terminal: TerminalInfo;
  /** What it runs: a coding agent's name, or the command. */
  readonly title: string;
  readonly time: string;
}

export type SidebarRow = OpenTabRow | ClosedChatRow | BackgroundTerminalRow;

/**
 * Every workspace's rows, in the order the sidebar lists them: its pinned chats, then its open tabs
 * in the tab bar's order, then what was closed and can come back, newest first: chats, and
 * terminals still running. Chats whose workspace was removed are returned apart.
 */
export function sidebarRows(
  workspace: Pick<WorkspaceSnapshot, "projects"> | null,
  chats: readonly AgentInfo[],
  terminals: readonly TerminalInfo[],
  /** What background terminals' tabs were called when they closed. */
  closedNames: ReadonlyMap<string, string> = new Map(),
) {
  const rows = new Map<string, SidebarRow[]>();
  for (const project of workspace?.projects ?? []) {
    const open: SidebarRow[] = project.tabs.map((tab) => {
      const pane = mainPane(tab);
      const chat =
        pane?.profile === "chat" ? chats.find((item) => item.id === pane.sessionId) : undefined;
      const terminalOf = (node: PaneNode | undefined) =>
        node && node.profile !== "chat"
          ? terminals.find((item) => item.id === node.sessionId)
          : undefined;
      const main = terminalOf(pane);
      // Named after the main pane, but a live agent elsewhere in the split speaks for the row
      // when the main pane's has stopped, as the tab's own status icons do.
      const terminal =
        pane?.profile === "chat" || (main && isLiveTerminalAgent(main))
          ? main
          : (tabPanes(tab)
              .map(terminalOf)
              .find((item) => item && isLiveTerminalAgent(item)) ?? main);
      const tool =
        pane?.profile === "chat"
          ? "chat"
          : terminal && isLiveTerminalAgent(terminal)
            ? (terminal.detectedAgent ?? terminal.profile)
            : (pane?.profile ?? "shell");
      return {
        kind: "tab",
        key: `tab:${tab.id}`,
        projectId: project.id,
        tabId: tab.id,
        title: tabTitle(tab, chats, terminals),
        chat,
        terminal,
        tool,
        time: chat?.updatedAt ?? terminal?.startedAt ?? firstSeen(tab.id),
      };
    });
    rows.set(project.id, open);
  }
  const closed: SidebarRow[] = [
    ...closedChats(workspace, chats).map((chat) => ({
      kind: "closed" as const,
      key: `closed:${chat.agent.id}`,
      projectId: chat.agent.projectId,
      chat,
      time: chat.agent.updatedAt,
    })),
    ...backgroundTerminals(workspace, terminals).map((terminal) => ({
      kind: "terminal" as const,
      key: `terminal:${terminal.id}`,
      projectId: terminal.projectId,
      terminal,
      title: closedNames.get(terminal.id) ?? terminalActivity(terminal) ?? "Terminal",
      time: terminal.startedAt,
    })),
  ];
  for (const row of closed.sort((a, b) => b.time.localeCompare(a.time)))
    rows.get(row.projectId)?.push(row);
  for (const [id, list] of rows)
    rows.set(id, [...list.filter(rowPinned), ...list.filter((row) => !rowPinned(row))]);
  return { rows, unavailable: unavailableChats(workspace, chats) };
}

/** Whether the row's chat is pinned to the top of its workspace. */
export function rowPinned(row: SidebarRow): boolean {
  return row.kind === "tab"
    ? !!row.chat?.pinned
    : row.kind === "closed"
      ? !!row.chat.agent.pinned
      : false;
}

// A tab that has not started its session yet has no time of its own, so it is timed from when this
// window first listed it.
const seen = new Map<string, string>();
function firstSeen(tabId: string) {
  let time = seen.get(tabId);
  if (!time) seen.set(tabId, (time = new Date().toISOString()));
  return time;
}

/** The agent a row speaks for, chat or CLI, while there is one. */
export function rowAgentStatus(row: SidebarRow): AgentStatus | undefined {
  if (row.kind === "closed") return undefined;
  if (row.kind === "tab" && row.chat) return chatAgentStatus(row.chat);
  return row.terminal && isLiveTerminalAgent(row.terminal)
    ? terminalAgentStatus(row.terminal)
    : undefined;
}

/**
 * What the row shows before its name: "attention" (red) when its agent waits for an answer or
 * failed, "done" (white) when it finished and nobody has looked yet, and "working" while an agent
 * replies, sub-agents included, even with its tab closed. A shell running a command, and any
 * terminal still running with its tab closed, is "running". A CLI agent in the background still
 * turns red when it waits for an answer.
 */
export function rowState(
  row: SidebarRow,
): "working" | "running" | "attention" | "done" | undefined {
  if (row.kind === "terminal") {
    if (!isLiveTerminalAgent(row.terminal)) return "running";
    if (row.terminal.agentActivity === "needs_input") return "attention";
    return terminalAgentStatus(row.terminal).running ? "running" : undefined;
  }
  const chat = row.kind === "closed" ? row.chat.agent : row.chat;
  if (chat) {
    const status = agentDisplayStatus(chat);
    if (row.kind === "tab" && (status === "needs_input" || status === "failed")) return "attention";
    if (row.kind === "tab" && chat.attention && !chat.attention.seen) return "done";
    if (status !== "starting" && status !== "working" && !chat.backgroundAgents) return undefined;
    return "working";
  }
  if (row.kind === "closed" || !row.terminal) return undefined;
  if (!isLiveTerminalAgent(row.terminal))
    return row.terminal.status === "running" && row.terminal.foregroundCommand
      ? "running"
      : undefined;
  if (row.terminal.agentActivity === "needs_input") return "attention";
  return terminalAgentStatus(row.terminal).running ? "working" : undefined;
}

/** Saved chats whose workspace no longer exists, newest first, once per pane they were shown in. */
function unavailableChats(
  workspace: Pick<WorkspaceSnapshot, "projects"> | null,
  chats: readonly AgentInfo[],
): AgentInfo[] {
  if (!workspace) return [];
  const projects = new Set(workspace.projects.map((project) => project.id));
  const latest = new Map<string, AgentInfo>();
  for (const chat of chats) {
    if (projects.has(chat.projectId) || (chat.turnId === null && !chat.nativeImport)) continue;
    const key = chat.providerGroupId ?? chat.id;
    const seen = latest.get(key);
    if (!seen || chat.updatedAt > seen.updatedAt) latest.set(key, chat);
  }
  return [...latest.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Keeps rows where they were while the pointer is over the list, so the row under it never moves.
 * Rows that are new since then follow, in their own order.
 */
export function stableOrder<T extends { key: string }>(
  rows: readonly T[],
  previous: readonly string[] | undefined,
): T[] {
  if (!previous) return [...rows];
  const index = new Map(previous.map((key, position) => [key, position]));
  return rows
    .map((row, position) => ({ row, rank: index.get(row.key) ?? previous.length + position }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ row }) => row);
}

/** Compact ages for sidebar rows: "now", "5m", "3h", "4d", "2mo", "1y". */
export function shortAge(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Ages move on by themselves, so the list repaints once a minute. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
