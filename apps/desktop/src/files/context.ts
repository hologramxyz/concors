import { createContext, useContext } from "react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { WorkspaceProject, WorkspaceSnapshot } from "@concors/protocol";
import type { FileSidebarState } from "./sidebar-state";
import type { FileDocument } from "./document";
import type { FileLocation } from "./links";
import type { DirectoryCache } from "./directory-cache";

export interface OpenFile {
  id: string;
  scope: string;
  projectId: string;
  directory: string;
  path: string;
  document: FileDocument;
  location: FileLocation;
  navigation: number;
}
interface FilesState {
  directories: DirectoryCache;
  sidebar: FileSidebarState;
  files: OpenFile[];
  active: Record<string, string | null>;
  open(project: WorkspaceProject, location: FileLocation): void;
  select(scope: string, id: string | null): void;
  close(file: OpenFile): void;
}
export const FilesContext = createContext<FilesState | null>(null);
export const FileLinkContext = createContext<
  ((href: string, sourcePath?: string) => boolean) | null
>(null);
export function useFiles() {
  const state = useContext(FilesContext);
  if (!state) throw new Error("File provider is missing");
  return state;
}
export function fileScope(machineId: string, epoch: string, projectId: string) {
  return `${machineId}:${epoch}:${projectId}`;
}

const lastWorkspaces = new WeakMap<DaemonConnection, WorkspaceSnapshot>();
/**
 * The live workspace, or the last one seen while the connection is being restored, so file
 * scopes (and the trees keyed by them) stay put through a reconnect.
 */
export function knownWorkspace(connection: DaemonConnection | null): WorkspaceSnapshot | null {
  if (!connection) return null;
  const live = connection.workspace;
  if (live) lastWorkspaces.set(connection, live);
  return live ?? lastWorkspaces.get(connection) ?? null;
}
