import {
  WorkspaceSnapshotSchema,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
  type WorkspaceTab,
} from "./workspace.ts";

export class WorkspaceOperationError extends Error {
  override readonly name = "WorkspaceOperationError";
  readonly code: "CONFLICT" | "NOT_FOUND" | "INVALID_OPERATION" | "LIMIT_EXCEEDED";
  constructor(code: WorkspaceOperationError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined)
    throw new WorkspaceOperationError("NOT_FOUND", `${label} no longer exists`);
  return value;
}

function closeTab(state: WorkspaceSnapshot, projectId: string, tabId: string): void {
  const project = requireValue(
    state.projects.find((p) => p.id === projectId),
    "Project",
  );
  const index = project.tabs.findIndex((tab) => tab.id === tabId);
  project.tabs = project.tabs.filter((tab) => tab.id !== tabId);
  if (state.selection?.tabId === tabId) {
    state.selection = {
      projectId,
      tabId: (project.tabs[index] ?? project.tabs[index - 1])?.id ?? null,
    };
  }
}

/** Validate the whole tree, including unreachable nodes, shared children, and cycles. */
export function validateLayout(tab: WorkspaceTab): void {
  const byId = new Map(tab.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id))
      throw new WorkspaceOperationError(
        "INVALID_OPERATION",
        "Layout contains a cycle or shared child",
      );
    visited.add(id);
    const node = requireValue(byId.get(id), "Layout node");
    if (node.kind === "split") {
      visit(node.first);
      visit(node.second);
    }
  };
  visit(tab.root);
  if (visited.size !== tab.nodes.length)
    throw new WorkspaceOperationError(
      "INVALID_OPERATION",
      "Layout contains duplicate or unreachable nodes",
    );
}

/** Pure commands; neither rendering nor process creation belongs in this reducer. */
export function applyWorkspaceOperation(
  current: WorkspaceSnapshot,
  op: WorkspaceOperation,
): WorkspaceSnapshot {
  const state = WorkspaceSnapshotSchema.parse(current);
  const allIds = new Set(
    state.projects.flatMap((p) => [
      p.id,
      ...p.tabs.flatMap((t) => [t.id, ...t.nodes.map((n) => n.id)]),
    ]),
  );
  const claim = (id: string): void => {
    if (allIds.has(id)) throw new WorkspaceOperationError("INVALID_OPERATION", "ID already exists");
    allIds.add(id);
  };
  if (op.kind === "project.add") {
    claim(op.projectId);
    if (op.directoryMode !== "follow" && state.projects.some((p) => p.directory === op.directory))
      throw new WorkspaceOperationError("INVALID_OPERATION", "Directory is already registered");
    state.projects.push({
      id: op.projectId,
      name: op.name,
      directory: op.directory,
      ...(op.directoryMode ? { directoryMode: op.directoryMode } : {}),
      version: 0,
      tabs: [],
    });
    state.selection = { projectId: op.projectId, tabId: null };
  } else {
    const project = requireValue(
      state.projects.find((p) => p.id === op.projectId),
      "Project",
    );
    if (op.kind === "selection.set") {
      if (op.tabId !== null)
        requireValue(
          project.tabs.find((t) => t.id === op.tabId),
          "Tab",
        );
      state.selection = { projectId: project.id, tabId: op.tabId };
    } else {
      if (project.version !== op.expectedVersion)
        throw new WorkspaceOperationError(
          "CONFLICT",
          "Project changed on another client. Review the refreshed workspace and retry.",
        );
      project.version++;
      if (op.kind === "project.remove") {
        state.projects = state.projects.filter((p) => p.id !== project.id);
        if (state.selection?.projectId === project.id) state.selection = null;
      } else if (op.kind === "project.pin") {
        if (project.directory !== op.directory)
          throw new WorkspaceOperationError(
            "CONFLICT",
            "Folder changed. Review it before pinning.",
          );
        project.directoryMode = "pinned";
        delete project.followPaneId;
      } else if (op.kind === "tab.create") {
        claim(op.tabId);
        claim(op.paneId);
        const source = op.sourcePaneId
          ? requireValue(
              project.tabs
                .flatMap((tab) => tab.nodes)
                .find((node) => node.id === op.sourcePaneId && node.kind === "pane"),
              "Source pane",
            )
          : undefined;
        const directory =
          source?.kind === "pane" ? (source.directory ?? project.directory) : project.directory;
        if (
          project.directoryMode === "follow" &&
          !project.followPaneId &&
          !project.tabs.length &&
          op.profile === "shell"
        )
          project.followPaneId = op.paneId;
        project.tabs.push({
          id: op.tabId,
          name: op.name,
          root: op.paneId,
          nodes: [{ id: op.paneId, kind: "pane", profile: op.profile, sessionId: null, directory }],
        });
        state.selection = { projectId: project.id, tabId: op.tabId };
      } else {
        const tab = requireValue(
          project.tabs.find((t) => t.id === op.tabId),
          "Tab",
        );
        switch (op.kind) {
          case "tab.rename":
            tab.name = op.name;
            break;
          case "tab.move": {
            if (op.index >= project.tabs.length)
              throw new WorkspaceOperationError(
                "INVALID_OPERATION",
                "Tab position is out of range",
              );
            project.tabs.splice(project.tabs.indexOf(tab), 1);
            project.tabs.splice(op.index, 0, tab);
            break;
          }
          case "tab.close":
            closeTab(state, project.id, tab.id);
            break;
          case "pane.resize": {
            const split = requireValue(
              tab.nodes.find((n) => n.id === op.splitId),
              "Split",
            );
            if (split.kind !== "split")
              throw new WorkspaceOperationError("INVALID_OPERATION", "Target is not a split");
            split.ratio = op.ratio;
            break;
          }
          case "pane.move": {
            const source = requireValue(
              tab.nodes.find((n) => n.id === op.paneId),
              "Source pane",
            );
            const target = requireValue(
              tab.nodes.find((n) => n.id === op.targetPaneId),
              "Target pane",
            );
            if (source.kind !== "pane" || target.kind !== "pane" || source.id === target.id)
              throw new WorkspaceOperationError("INVALID_OPERATION", "Choose two different panes");
            if (op.placement === "center") {
              const swap = (id: string) =>
                id === source.id ? target.id : id === target.id ? source.id : id;
              for (const node of tab.nodes)
                if (node.kind === "split") {
                  node.first = swap(node.first);
                  node.second = swap(node.second);
                }
            } else {
              claim(op.splitId);
              const parent = requireValue(
                tab.nodes.find(
                  (n) => n.kind === "split" && (n.first === source.id || n.second === source.id),
                ),
                "Source parent",
              );
              if (parent.kind !== "split")
                throw new WorkspaceOperationError("INVALID_OPERATION", "Invalid source parent");
              const sibling = parent.first === source.id ? parent.second : parent.first;
              const replace = (from: string, to: string) => {
                if (tab.root === from) tab.root = to;
                for (const node of tab.nodes)
                  if (node.kind === "split") {
                    if (node.first === from) node.first = to;
                    if (node.second === from) node.second = to;
                  }
              };
              replace(parent.id, sibling);
              tab.nodes = tab.nodes.filter((n) => n.id !== parent.id);
              const destination = op.scope === "workspace" ? tab.root : target.id;
              replace(destination, op.splitId);
              const before = op.placement === "left" || op.placement === "top";
              tab.nodes.push({
                id: op.splitId,
                kind: "split",
                ratio: 0.5,
                axis:
                  op.placement === "left" || op.placement === "right" ? "horizontal" : "vertical",
                first: before ? source.id : destination,
                second: before ? destination : source.id,
              });
            }
            break;
          }
          case "pane.configure":
          case "pane.split":
          case "pane.close": {
            const pane = requireValue(
              tab.nodes.find((n) => n.id === op.paneId),
              "Pane",
            );
            if (pane.kind !== "pane")
              throw new WorkspaceOperationError("INVALID_OPERATION", "Target is not a pane");
            if (op.kind === "pane.configure") {
              // Changing the view detaches its binding; runtime sessions remain alive and discoverable.
              if (pane.profile !== op.profile) pane.sessionId = null;
              pane.profile = op.profile;
            } else if (op.kind === "pane.split") {
              claim(op.newPaneId);
              claim(op.splitId);
              for (const node of tab.nodes)
                if (node.kind === "split") {
                  if (node.first === pane.id) node.first = op.splitId;
                  if (node.second === pane.id) node.second = op.splitId;
                }
              if (tab.root === pane.id) tab.root = op.splitId;
              tab.nodes.push(
                {
                  id: op.splitId,
                  kind: "split",
                  axis: op.axis,
                  ratio: 0.5,
                  first: op.before ? op.newPaneId : pane.id,
                  second: op.before ? pane.id : op.newPaneId,
                },
                {
                  id: op.newPaneId,
                  kind: "pane",
                  profile: op.profile,
                  sessionId: null,
                  directory: pane.directory ?? project.directory,
                },
              );
            } else if (tab.root === pane.id) closeTab(state, project.id, tab.id);
            else {
              const parent = requireValue(
                tab.nodes.find(
                  (n) => n.kind === "split" && (n.first === pane.id || n.second === pane.id),
                ),
                "Parent split",
              );
              if (parent.kind !== "split")
                throw new WorkspaceOperationError("INVALID_OPERATION", "Invalid parent");
              const sibling = parent.first === pane.id ? parent.second : parent.first;
              for (const node of tab.nodes)
                if (node.kind === "split") {
                  if (node.first === parent.id) node.first = sibling;
                  if (node.second === parent.id) node.second = sibling;
                }
              if (tab.root === parent.id) tab.root = sibling;
              tab.nodes = tab.nodes.filter((n) => n.id !== parent.id && n.id !== pane.id);
            }
            break;
          }
        }
      }
    }
  }
  for (const project of state.projects) {
    if (project.directoryMode !== "follow" || !project.followPaneId) continue;
    const anchor = project.tabs
      .flatMap((tab) => tab.nodes)
      .find((node) => node.id === project.followPaneId);
    if (!anchor || anchor.kind !== "pane" || anchor.profile !== "shell") {
      project.directoryMode = "pinned";
      delete project.followPaneId;
    }
  }
  state.revision++;
  const parsed = WorkspaceSnapshotSchema.safeParse(state);
  if (!parsed.success)
    throw new WorkspaceOperationError(
      "LIMIT_EXCEEDED",
      "Workspace limit reached (64 projects, 32 tabs per project, 32 panes per tab)",
    );
  for (const project of state.projects) for (const tab of project.tabs) validateLayout(tab);
  return state;
}
