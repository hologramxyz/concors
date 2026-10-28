import { useCallback, useState } from "react";
import {
  nextWorkspaceTabName,
  TERMINAL_BIND_NEW_TAB_CAPABILITY,
  type TerminalInfo,
  type WorkspaceOperation,
} from "@concors/protocol";
import type { DaemonConnectionHandle } from "@/daemon/use-daemon-connection";
import {
  closingTerminals,
  isIdleShell,
  terminalActivity,
  type BackgroundTerminalActions,
} from "./background-terminals";

/**
 * Terminals keep running when their tab closes. This tells the user when that leaves something
 * running, stops a shell that was only waiting at a prompt, and brings a background terminal back
 * into a new tab of its workspace.
 */
export function useBackgroundTerminals(
  connection: DaemonConnectionHandle,
  {
    onReopen,
    onError,
  }: {
    /** Called before a terminal reopens, to show the workspace it reopens in. */
    onReopen: () => void;
    onError: (message: string) => void;
  },
) {
  const [closed, setClosed] = useState<TerminalInfo | null>(null);
  const [managing, setManaging] = useState(false);
  // Stable, so the notice's timer is not restarted on every render.
  const dismissClosed = useCallback(() => setClosed(null), []);
  const transport = connection.transport;
  const request = async (
    operation: Parameters<NonNullable<typeof transport>["requestTerminal"]>[0],
  ) => {
    if (!transport) throw new Error("Not connected");
    const result = await transport.requestTerminal(operation, crypto.randomUUID());
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
  };
  const fail = (fallback: string) => (cause: unknown) =>
    onError(cause instanceof Error ? cause.message : fallback);
  const stop = (terminal: TerminalInfo) => {
    setClosed((current) => (current?.id === terminal.id ? null : current));
    void request({ kind: "stop", sessionId: terminal.id }).catch(fail("Could not stop terminal"));
  };
  const reopen = (terminal: TerminalInfo) => {
    setClosed((current) => (current?.id === terminal.id ? null : current));
    const project = connection.workspace?.projects.find((item) => item.id === terminal.projectId);
    if (!project) return;
    onReopen();
    const tabId = crypto.randomUUID();
    const paneId = crypto.randomUUID();
    const name = nextWorkspaceTabName(project.tabs);
    void (async () => {
      if (
        transport?.state.status === "ready" &&
        transport.state.daemon.capabilities?.includes(TERMINAL_BIND_NEW_TAB_CAPABILITY)
      ) {
        await request({
          kind: "bind",
          projectId: project.id,
          tabId,
          paneId,
          expectedVersion: project.version,
          sessionId: terminal.id,
          newTab: { name },
        });
        return;
      }
      // Older daemons bind into an existing empty pane. A chat pane waits for a choice instead of
      // starting a session of its own, so it is still free when the terminal is bound into it.
      await connection.execute({
        kind: "tab.create",
        projectId: project.id,
        expectedVersion: project.version,
        tabId,
        paneId,
        name,
        profile: "chat",
      });
      const version = transport?.workspace?.projects.find(
        (item) => item.id === project.id,
      )?.version;
      try {
        await request({
          kind: "bind",
          projectId: project.id,
          tabId,
          paneId,
          expectedVersion: version ?? project.version + 1,
          sessionId: terminal.id,
        });
      } catch (cause) {
        const current = transport?.workspace?.projects.find((item) => item.id === project.id);
        if (current)
          await connection.execute({
            kind: "tab.close",
            projectId: project.id,
            expectedVersion: current.version,
            tabId,
          });
        throw cause;
      }
    })().catch(fail("Could not reopen terminal"));
  };
  const actions: BackgroundTerminalActions = { reopen, stop, manage: () => setManaging(true) };
  return {
    actions,
    /** The terminal the last close left running, for its notice. */
    closed,
    dismissClosed,
    managing,
    setManaging,
    /** The running terminals an operation is about to close, read before it runs. */
    closing: (operation: WorkspaceOperation): TerminalInfo[] => {
      if (operation.kind !== "tab.close" && operation.kind !== "pane.close") return [];
      const tab = connection.workspace?.projects
        .find((project) => project.id === operation.projectId)
        ?.tabs.find((item) => item.id === operation.tabId);
      return closingTerminals(
        tab,
        transport?.terminals ?? [],
        operation.kind === "pane.close" ? operation.paneId : undefined,
      );
    },
    /** After the close: idle shells stop, anything still running gets a notice. */
    afterClose: (terminals: readonly TerminalInfo[]) => {
      for (const terminal of terminals)
        if (terminalActivity(terminal)) setClosed(terminal);
        else if (isIdleShell(terminal)) stop(terminal);
    },
  };
}
