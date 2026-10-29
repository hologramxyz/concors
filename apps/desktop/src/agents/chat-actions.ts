import { useContext } from "react";
import type { DaemonConnection } from "@concors/daemon-client";
import {
  AGENT_PIN_DELETE_CAPABILITY,
  type AgentInfo,
  type WorkspaceOperation,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";

/** What a chat is called in the sidebar: its pane's or tab's name, or its own. */
export const chatName = (chat: Pick<AgentInfo, "name" | "paneName" | "tabName">) =>
  chat.paneName ?? chat.tabName ?? chat.name;

export const UNREACHABLE = "Couldn’t reach this computer. Try again.";
/** How long a failed delete waits for the machine to come back before saying it could not. */
const RECONNECT_WAIT_MS = 15_000;

/** How long putting a reopened chat's tab back waits for the tab to appear. */
const TAB_WAIT_MS = 5_000;

/** The machine answered and refused; its message is written for people. */
class Refused extends Error {}

/** Where a chat's tab was in its workspace's tab bar, so it can be put back there. */
export interface TabPlace {
  readonly projectId: string;
  readonly index: number;
}

/**
 * Resolves true once the machine is connected and its chat list is current again (the workspace
 * comes back only after the resync), or false after `ms`.
 */
function reconnected(connection: DaemonConnection, ms: number): Promise<boolean> {
  const ready = () => connection.state.status === "ready" && connection.workspace !== null;
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const stops: (() => void)[] = [];
    const finish = (value: boolean) => {
      clearTimeout(timer);
      for (const stop of stops) stop();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), ms);
    stops.push(
      connection.subscribe(() => ready() && finish(true)),
      connection.subscribeWorkspace(() => ready() && finish(true)),
    );
  });
}

/**
 * Pins and deletes chats, once the machine supports it. Deleting an open chat closes its pane
 * first, and with it the tab when the chat was all it showed.
 */
export function useChatActions(execute: (operation: WorkspaceOperation) => Promise<void>) {
  const connection = useContext(TerminalConnectionContext);
  if (
    !connection ||
    connection.state.status !== "ready" ||
    !connection.state.daemon.capabilities?.includes(AGENT_PIN_DELETE_CAPABILITY)
  )
    return null;
  const request = async (operation: Parameters<typeof connection.requestAgent>[0]) => {
    const result = await connection.requestAgent(operation, crypto.randomUUID());
    if (result.outcome.status === "error") throw new Refused(result.outcome.message);
  };
  const exists = (id: string) => connection.agents.some((agent) => agent.id === id);
  /** The chat's first tab in the tab bar, if it is shown. */
  const tabOf = (id: string) => {
    for (const project of connection.workspace?.projects ?? []) {
      const index = project.tabs.findIndex((tab) =>
        tab.nodes.some((node) => node.kind === "pane" && node.sessionId === id),
      );
      const tab = project.tabs[index];
      if (tab) return { project, tab, index };
    }
    return null;
  };
  /**
   * Closes every pane showing the chat, each against its workspace as it is by then, and says
   * where its tab was, or null when it was not shown. A tab that stays open for its other panes
   * leaves the chat's place just after it.
   */
  const closePanes = async (id: string): Promise<TabPlace | null> => {
    const first = tabOf(id);
    const shown = (connection.workspace?.projects ?? []).flatMap((project) =>
      project.tabs.flatMap((tab) =>
        tab.nodes
          .filter((node) => node.kind === "pane" && node.sessionId === id)
          .map((node) => ({ projectId: project.id, tabId: tab.id, paneId: node.id })),
      ),
    );
    for (const pane of shown) {
      const project = connection.workspace?.projects.find((item) => item.id === pane.projectId);
      if (!project) continue;
      await execute({ kind: "pane.close", ...pane, expectedVersion: project.version });
    }
    if (!first) return null;
    const kept = connection.workspace?.projects
      .find((project) => project.id === first.project.id)
      ?.tabs.some((tab) => tab.id === first.tab.id);
    return { projectId: first.project.id, index: first.index + (kept ? 1 : 0) };
  };
  /** Once the chat's tab is shown again, moves it to where it was. */
  const placeTab = async (id: string, place: TabPlace) => {
    const shown = () => {
      const found = tabOf(id);
      return found?.project.id === place.projectId ? found : null;
    };
    const found =
      shown() ??
      (await new Promise<ReturnType<typeof shown>>((resolve) => {
        const finish = (value: ReturnType<typeof shown>) => {
          clearTimeout(timer);
          stop();
          resolve(value);
        };
        const timer = setTimeout(() => finish(null), TAB_WAIT_MS);
        const stop = connection.subscribeWorkspace(() => {
          const value = shown();
          if (value) finish(value);
        });
      }));
    if (!found) return;
    const index = Math.min(place.index, found.project.tabs.length - 1);
    if (index === found.index) return;
    await execute({
      kind: "tab.move",
      projectId: found.project.id,
      tabId: found.tab.id,
      index,
      expectedVersion: found.project.version,
    });
  };
  return {
    pin: (chat: AgentInfo, pinned: boolean) => request({ kind: "pin", sessionId: chat.id, pinned }),
    closePanes,
    placeTab,
    /** Opens the chat in a tab again. */
    reopen: (id: string) => request({ kind: "open-session", sessionId: id }),
    /**
     * Deletes the chat with this ID. One already gone counts as deleted. When the machine cannot
     * be reached, it waits for it to come back and checks again before saying so.
     */
    remove: async (id: string) => {
      try {
        if (!exists(id)) return;
        await closePanes(id);
        await request({ kind: "delete", sessionId: id });
      } catch (cause) {
        if (cause instanceof Refused && connection.state.status === "ready") {
          if (!exists(id)) return;
          throw cause;
        }
        const back = await reconnected(connection, RECONNECT_WAIT_MS);
        if (back && !exists(id)) return;
        throw new Error(cause instanceof Refused && back ? cause.message : UNREACHABLE, { cause });
      }
    },
  };
}
export type ChatActions = NonNullable<ReturnType<typeof useChatActions>>;
