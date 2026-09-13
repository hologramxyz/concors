import type { AgentInfo, PaneProfile, WorkspaceProject } from "@concors/protocol";
import { tabPanes } from "@/workspace/tab-panes";
import type { SessionPane } from "@/workspace/session-pane";

export type SearchCategory = "all" | "workspaces" | "tabs" | "commands";
export interface SearchEntry {
  id: string;
  kind: "workspace" | "pane";
  title: string;
  detail: string;
  keywords: string;
  projectId: string;
  target?: SessionPane;
  profile?: PaneProfile;
  agent?: AgentInfo;
}
const profileNames: Record<PaneProfile, string> = {
  shell: "Terminal",
  chat: "Agent",
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
};

/** Metadata only. Do not fetch transcript bodies or read the filesystem to populate Search. */
export function workspaceEntries(
  projects: readonly WorkspaceProject[],
  agents: readonly AgentInfo[],
) {
  const sessions = new Map(agents.map((agent) => [agent.id, agent]));
  return projects.flatMap((project): SearchEntry[] => [
    {
      id: `workspace:${project.id}`,
      kind: "workspace",
      title: project.name,
      detail: project.directory,
      keywords: "workspace project repository folder",
      projectId: project.id,
    },
    ...project.tabs.flatMap((tab) => {
      const panes = tabPanes(tab);
      return panes.map((pane, index): SearchEntry => {
        const candidate = pane.sessionId ? sessions.get(pane.sessionId) : undefined;
        const agent = candidate?.projectId === project.id ? candidate : undefined;
        const label = pane.terminalProfile?.name ?? profileNames[pane.profile];
        const title = panes.length > 1 ? `${tab.name} · ${index + 1}` : tab.name;
        const context = [project.name, agent?.name ?? label];
        if (agent && agent.name !== (agent.providerLabel ?? agent.provider))
          context.push(agent.providerLabel ?? agent.provider);
        return {
          id: `pane:${project.id}:${tab.id}:${pane.id}`,
          kind: "pane",
          title,
          detail: context.join(" · "),
          keywords: [
            "tab pane",
            label,
            pane.directory ?? project.directory,
            agent?.directory,
            agent?.provider,
            agent?.providerLabel,
            agent?.model,
          ]
            .filter(Boolean)
            .join(" "),
          projectId: project.id,
          target: { projectId: project.id, tabId: tab.id, paneId: pane.id },
          profile: pane.profile,
          ...(agent ? { agent } : {}),
        };
      });
    }),
  ]);
}

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
/** All terms must match, in any order. Prefer exact names over path/metadata matches. */
export function matchScore(query: string, title: string, detail = "", keywords = ""): number {
  const needle = normalize(query);
  if (!needle) return 1;
  const name = normalize(title);
  const context = normalize(`${detail} ${keywords}`);
  const terms = needle.split(/\s+/);
  if (!terms.every((term) => name.includes(term) || context.includes(term))) return 0;
  if (name === needle) return 100;
  if (name.startsWith(needle)) return 80;
  if (name.includes(needle)) return 60;
  return terms.every((term) => name.includes(term)) ? 40 : 20;
}

export function searchEntries(
  entries: readonly SearchEntry[],
  query: string,
  category: SearchCategory,
  activeProjectId?: string | undefined,
) {
  if (category === "commands") return [];
  return entries
    .filter(
      (entry) =>
        category === "all" || entry.kind === (category === "workspaces" ? "workspace" : "pane"),
    )
    .map((entry) => ({
      entry,
      score: matchScore(query, entry.title, entry.detail, entry.keywords),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.entry.projectId === activeProjectId) -
          Number(a.entry.projectId === activeProjectId) ||
        Number(a.entry.kind === "pane") - Number(b.entry.kind === "pane") ||
        a.entry.title.localeCompare(b.entry.title, undefined, { numeric: true }),
    )
    .map(({ entry }) => entry);
}
