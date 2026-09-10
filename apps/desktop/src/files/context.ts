import { createContext, useContext } from "react";
import type { WorkspaceProject } from "@concors/protocol";
import type { FileSidebarState } from "./sidebar-state";
import type { FileDocument } from "./document";
import type { FileLocation } from "./links";

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
