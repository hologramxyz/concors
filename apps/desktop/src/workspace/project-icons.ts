import type { DaemonConnection } from "@concors/daemon-client";
import {
  PROJECT_ICON_CAPABILITY,
  type ProjectIcon,
  type WorkspaceProject,
  type WorkspaceSnapshot,
} from "@concors/protocol";

export const projectIconKey = (
  epoch: string,
  project: Pick<WorkspaceProject, "id" | "directory">,
) => JSON.stringify([epoch, project.id, project.directory]);

/** Shared across sidebar modes; stale replies cannot replace icons after cd or machine changes. */
export class ProjectIconCache {
  private entries = new Map<string, { loading: boolean; expires: number }>();
  private icons = new Map<string, ProjectIcon>();
  private listeners = new Set<() => void>();
  private connection: Pick<DaemonConnection, "state" | "requestFile">;
  constructor(connection: Pick<DaemonConnection, "state" | "requestFile">) {
    this.connection = connection;
  }
  getSnapshot = () => this.icons;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(icons: Map<string, ProjectIcon>) {
    this.icons = icons;
    for (const listener of this.listeners) listener();
  }
  refresh(workspace: WorkspaceSnapshot) {
    if (
      this.connection.state.status !== "ready" ||
      !this.connection.state.daemon.capabilities?.includes(PROJECT_ICON_CAPABILITY)
    ) {
      this.entries.clear();
      if (this.icons.size) this.publish(new Map());
      return;
    }
    const keys = new Set(workspace.projects.map((p) => projectIconKey(workspace.epoch, p)));
    for (const key of this.entries.keys()) if (!keys.has(key)) this.entries.delete(key);
    if ([...this.icons.keys()].some((key) => !keys.has(key)))
      this.publish(new Map([...this.icons].filter(([key]) => keys.has(key))));
    for (const project of workspace.projects) {
      const key = projectIconKey(workspace.epoch, project);
      const previous = this.entries.get(key);
      if (previous?.loading || (previous && previous.expires > Date.now())) continue;
      const entry = { loading: true, expires: 0 };
      this.entries.set(key, entry);
      void this.connection
        .requestFile(
          {
            kind: "project-icon",
            epoch: workspace.epoch,
            projectId: project.id,
            directory: project.directory,
            path: "",
          },
          crypto.randomUUID(),
        )
        .then((result) => {
          if (this.entries.get(key) !== entry) return;
          entry.expires = Date.now() + (result.outcome.status === "project-icon" ? 60000 : 10000);
          if (result.outcome.status === "project-icon")
            this.publish(new Map(this.icons).set(key, result.outcome.icon));
        })
        .catch(() => {
          entry.expires = Date.now() + 10000;
        })
        .finally(() => {
          entry.loading = false;
        });
    }
  }
}

const caches = new WeakMap<DaemonConnection, ProjectIconCache>();
export function projectIcons(connection: DaemonConnection) {
  let cache = caches.get(connection);
  if (!cache) {
    cache = new ProjectIconCache(connection);
    caches.set(connection, cache);
  }
  return cache;
}
