import { useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { WorkspaceProject } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useFileSidebar } from "./sidebar-state";
import { FileDocument } from "./document";
import { resolveFileLink, type FileLocation } from "./links";
import { FilesContext, FileLinkContext, fileScope, useFiles, type OpenFile } from "./context";
import { useFilePrompts } from "./prompts";
import { CompactLayoutContext } from "@/components/compact-layout";
export function FilesProvider({
  children,
  beforeLeaveRef,
  leaveLabel = "sign out",
}: {
  children: ReactNode;
  beforeLeaveRef: RefObject<(() => boolean | Promise<boolean>) | null>;
  leaveLabel?: string;
}) {
  const prompts = useFilePrompts();
  const compact = useContext(CompactLayoutContext);
  const sidebar = useFileSidebar();
  const connection = useContext(TerminalConnectionContext);
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<Record<string, string | null>>({});
  const currentFiles = useRef(files);
  useEffect(() => {
    currentFiles.current = files;
  }, [files]);
  useEffect(() => {
    beforeLeaveRef.current = () => {
      if (currentFiles.current.some((file) => file.document.getSnapshot().busy)) {
        prompts.notify(`Wait for the file operation to finish before you ${leaveLabel}.`);
        return false;
      }
      return (
        !currentFiles.current.some((file) => file.document.dirty) ||
        prompts.confirm(`Discard unsaved file changes and ${leaveLabel}?`)
      );
    };
    const guard = (event: BeforeUnloadEvent) => {
      if (
        currentFiles.current.some((file) => file.document.dirty || file.document.getSnapshot().busy)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
      beforeLeaveRef.current = null;
    };
  }, [beforeLeaveRef, prompts, leaveLabel]);
  const select = (scope: string, id: string | null) =>
    setActive((current) => ({ ...current, [scope]: id }));
  const open = (project: WorkspaceProject, location: FileLocation) => {
    const workspace = connection?.workspace;
    if (!workspace) return;
    if (
      connection.state.status !== "ready" ||
      !connection.state.daemon.capabilities?.includes("project-files")
    ) {
      prompts.notify("Update or reconnect this machine to open project files.");
      return;
    }
    const scope = fileScope(workspace.machineId, workspace.epoch, project.id);
    const id = JSON.stringify([scope, project.directory, location.path]);
    if (!files.some((file) => file.id === id) && files.length >= 32) {
      prompts.notify("Close a file tab before opening more files (32 maximum).");
      return;
    }
    setFiles((current) => {
      const existing = current.find((file) => file.id === id);
      if (existing)
        return current.map((file) =>
          file.id === id ? { ...file, location, navigation: file.navigation + 1 } : file,
        );
      if (current.length >= 32) return current;
      return [
        ...current,
        {
          id,
          scope,
          path: location.path,
          projectId: project.id,
          directory: project.directory,
          location,
          navigation: 0,
          document: new FileDocument({
            projectId: project.id,
            epoch: workspace.epoch,
            directory: project.directory,
            path: location.path,
          }),
        },
      ];
    });
    select(scope, id);
    if (compact) sidebar.setOpen(true);
  };
  const close = async (file: OpenFile) => {
    if (file.document.getSnapshot().busy) return;
    if (file.document.dirty && !(await prompts.confirm(`Discard unsaved changes to ${file.path}?`)))
      return;
    if (file.document.getSnapshot().busy) return;
    setFiles((current) => current.filter((item) => item.id !== file.id));
    setActive((current) => ({
      ...current,
      [file.scope]: current[file.scope] === file.id ? null : (current[file.scope] ?? null),
    }));
  };
  return (
    <FilesContext value={{ files, active, open, select, close, sidebar }}>{children}</FilesContext>
  );
}
export function ProjectFileLinks({
  project,
  children,
}: {
  project: WorkspaceProject;
  children: ReactNode;
}) {
  const files = useFiles();
  return (
    <FileLinkContext
      value={(href, sourcePath) => {
        const location = resolveFileLink(href, project.directory, sourcePath);
        if (!location) return false;
        files.open(project, location);
        return true;
      }}
    >
      {children}
    </FileLinkContext>
  );
}
