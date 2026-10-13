import { useCallback, useContext } from "react";
import type { FileOperation } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import type { OpenFile } from "./context";

/** Whether this machine still serves the file's project, and a request bound to it. */
export function useFileRequest(file: OpenFile) {
  const connection = useContext(TerminalConnectionContext);
  const available =
    connection?.state.status === "ready" &&
    connection.workspace?.epoch === file.document.target.epoch &&
    connection.workspace.projects.some(
      (project) =>
        project.id === file.projectId &&
        (project.directory === file.directory ||
          (connection.state.status === "ready" &&
            connection.state.daemon.capabilities?.includes("folder-workspaces"))),
    ) &&
    !!connection.state.daemon.capabilities?.includes("project-files");
  const request = useCallback(
    async (operation: FileOperation) => {
      if (!connection || !available)
        throw new Error("Reconnect to this machine before saving. Your draft is kept.");
      return (await connection.requestFile(operation, crypto.randomUUID())).outcome;
    },
    [connection, available],
  );
  const capabilities =
    connection?.state.status === "ready" ? (connection.state.daemon.capabilities ?? []) : [];
  return { available, request, capabilities };
}
