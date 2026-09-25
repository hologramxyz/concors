import type { AgentInfo, WorkspaceSnapshot } from "@concors/protocol";
import { matchScore } from "@/search/index";

/** The agents a closed chat can come back as. Other harnesses are not resumable here yet. */
export const RESUMABLE_ENGINES = ["codex", "claude", "opencode"] as const;
export type ResumableEngine = (typeof RESUMABLE_ENGINES)[number];

export interface ClosedChat {
  readonly agent: AgentInfo;
  readonly engine: ResumableEngine;
  /** What its pane was called: the pane's name, else its tab's, else the agent's own. */
  readonly title: string;
  readonly projectName: string;
}

function resumableEngine(agent: AgentInfo): ResumableEngine | null {
  const engine = agent.engine ?? agent.provider;
  return (RESUMABLE_ENGINES as readonly string[]).includes(engine)
    ? (engine as ResumableEngine)
    : null;
}

/**
 * Chats that no pane shows any more, most recently active first. The conversations one pane
 * switched between share a group and come back as the latest of them, so a pane is listed once;
 * a group with a conversation still open is not closed. Chats never sent a message are skipped.
 */
export function closedChats(
  workspace: WorkspaceSnapshot | null,
  agents: readonly AgentInfo[],
): ClosedChat[] {
  if (!workspace) return [];
  const shown = new Set<string>();
  for (const project of workspace.projects)
    for (const tab of project.tabs)
      for (const node of tab.nodes)
        if (node.kind === "pane" && node.sessionId) shown.add(node.sessionId);
  const projects = new Map(workspace.projects.map((project) => [project.id, project]));
  const groups = new Map<string, AgentInfo[]>();
  for (const agent of agents) {
    const key = agent.providerGroupId ?? agent.id;
    groups.set(key, [...(groups.get(key) ?? []), agent]);
  }
  const chats: ClosedChat[] = [];
  for (const members of groups.values()) {
    if (members.some((agent) => shown.has(agent.id))) continue;
    const latest = members
      .filter(
        (agent) =>
          resumableEngine(agent) &&
          projects.has(agent.projectId) &&
          (agent.turnId !== null || !!agent.nativeImport),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const engine = latest && resumableEngine(latest);
    if (!latest || !engine) continue;
    const named = members.find((agent) => agent.paneName ?? agent.tabName);
    chats.push({
      agent: latest,
      engine,
      title:
        latest.paneName ??
        latest.tabName ??
        named?.paneName ??
        named?.tabName ??
        (latest.name.trim() || "Untitled chat"),
      projectName: projects.get(latest.projectId)?.name ?? "",
    });
  }
  return chats.sort((a, b) => b.agent.updatedAt.localeCompare(a.agent.updatedAt));
}

/** Names first, then the agent, model and workspace; recency breaks ties. */
export function searchClosedChats(chats: readonly ClosedChat[], query: string): ClosedChat[] {
  if (!query.trim()) return [...chats];
  return chats
    .map((chat, index) => ({
      chat,
      index,
      score: matchScore(
        query,
        chat.title,
        [chat.agent.name, chat.agent.providerLabel, chat.agent.model, chat.projectName]
          .filter(Boolean)
          .join(" "),
        [chat.engine, chat.agent.provider, chat.agent.tabName].filter(Boolean).join(" "),
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ chat }) => chat);
}
