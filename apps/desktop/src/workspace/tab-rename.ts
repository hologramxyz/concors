import {
  isDefaultTabName,
  type AgentInfo,
  type LayoutNode,
  type TerminalInfo,
  type WorkspaceOperation,
  type WorkspaceProject,
  type WorkspaceTab,
} from "@concors/protocol";
import { defaultPaneTitle, mainPane } from "./tab-title";
import { tabPanes } from "./tab-panes";

type Pane = Extract<LayoutNode, { kind: "pane" }>;
type Agents = readonly Pick<AgentInfo, "id" | "name">[];
type Terminals = readonly Pick<TerminalInfo, "id" | "status" | "foregroundCommand">[];

/** What a rename names: one pane, or the whole tab. */
export type RenameTarget = { kind: "pane"; pane: Pane } | { kind: "tab" };

/**
 * What renaming a tab, or one pane of it, should name, for desktop's sidebar rows and the phone's
 * tab menu alike. A tab nobody named shows its main pane's title, so renaming it names that pane:
 * the tab, the pane and the chat once closed all keep the name, and clearing it returns to the
 * automatic one. One pane of a split tab, which the phone shows as a tab of its own, is named
 * itself, since the tab's name is its siblings' too. A tab with a name of its own is renamed
 * itself. Daemons without pane names can only rename tabs, so they get no pane target.
 *
 * `pane` is the pane the caller shows on its own; desktop's rows show whole tabs and pass none.
 * Returns null when nothing can be renamed: a split tab's pane on a daemon without pane names.
 */
export function renameTarget(
  tab: WorkspaceTab,
  pane: Pane | undefined,
  canRenamePanes: boolean,
): RenameTarget | null {
  const split = !!pane && tabPanes(tab).length > 1;
  const named = pane ?? mainPane(tab);
  if (canRenamePanes && named && (split || isDefaultTabName(tab.name)))
    return { kind: "pane", pane: named };
  return split ? null : { kind: "tab" };
}

/**
 * The operation a rename to `value` sends, or null when it would change nothing. `current` is the
 * title the tab shows now, which keeping leaves an unnamed tab following its pane.
 */
export function renameOperation(
  project: Pick<WorkspaceProject, "id" | "version">,
  tab: Pick<WorkspaceTab, "id">,
  target: RenameTarget,
  value: string,
  current: string,
  agents: Agents,
  terminals: Terminals = [],
): WorkspaceOperation | null {
  const name = value.trim().slice(0, 120);
  if (target.kind === "pane") {
    const { pane } = target;
    const next = name && name !== defaultPaneTitle(pane, agents, terminals) ? name : null;
    if (next === (pane.name ?? null)) return null;
    return {
      kind: "pane.rename",
      projectId: project.id,
      expectedVersion: project.version,
      tabId: tab.id,
      paneId: pane.id,
      name: next,
    };
  }
  if (!name || name === current) return null;
  return {
    kind: "tab.rename",
    projectId: project.id,
    expectedVersion: project.version,
    tabId: tab.id,
    name,
  };
}
