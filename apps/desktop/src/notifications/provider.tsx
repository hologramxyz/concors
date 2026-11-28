import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { TerminalInfo } from "@concors/protocol";
import { NotificationContext } from "./context";
import { AttentionEngine, type Notice } from "./engine";
import { claimNotification, getNotificationPreferences } from "./preferences";
import { noticePlace } from "./place";
import { desktopNotice, notificationAccess, openNotificationSettings } from "./platform";
import { errorMessage, firstNotificationProblem, notificationProblem } from "./access";
import { isMac } from "@/shortcuts/bindings";
import { isTauri } from "@/tauri";
import { Button } from "@/components/ui/button";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { playAgentSound, unlockAudio } from "./sound";
import { terminalAgentSound } from "./terminal";
import { paneNames } from "@/agents/visible-sessions";
import { forgetTerminalTurn, markFailureSeen, markTerminalTurnSeen } from "@/agents/seen-updates";

interface Problem {
  message: string;
  settings?: boolean;
}

export function NotificationProvider({
  connection,
  onOpen,
  children,
  inAppOnly = false,
  sidebar = true,
}: {
  connection: DaemonConnection | null;
  onOpen: (id: string) => void;
  children: React.ReactNode;
  inAppOnly?: boolean;
  /**
   * The app shows a notice about notifications themselves ("Notifications are off for Concors")
   * in its sidebar, with `SidebarNotice`. The phone has none, so the notice shows over the page.
   * Agent events get no in-app card anywhere: the banner, the sound, the sidebar's dot and the
   * unread state already say them.
   */
  sidebar?: boolean;
}) {
  const views = useRef(new Map<string, number>());
  const lists = useRef(new Map<string, number>());
  const acknowledge = useRef<() => void>(() => undefined);
  const [problem, setProblem] = useState<Problem | null>(null);
  const view = useCallback((id: string) => {
    views.current.set(id, (views.current.get(id) ?? 0) + 1);
    acknowledge.current();
    return () => {
      const count = views.current.get(id) ?? 0;
      if (count <= 1) views.current.delete(id);
      else views.current.set(id, count - 1);
    };
  }, []);
  const list = useCallback((ids: readonly string[]) => {
    for (const id of ids) lists.current.set(id, (lists.current.get(id) ?? 0) + 1);
    return () => {
      for (const id of ids) {
        const count = lists.current.get(id) ?? 0;
        if (count <= 1) lists.current.delete(id);
        else lists.current.set(id, count - 1);
      }
    };
  }, []);
  useEffect(() => {
    if (!connection) return;
    let disposed = false,
      live = false;
    const closes = new Map<string, { id: string; close: () => void }>();
    const seenRequests = new Set<string>();
    const focused = (id: string) => windowInFront() && views.current.has(id);
    const clear = (id: string) => {
      closes.get(id)?.close();
      closes.delete(id);
    };
    const sound = (kind: Notice["kind"]) => {
      void playAgentSound(kind).catch((cause: unknown) => {
        if (disposed) return;
        // The desktop app plays through the system, so a failure there is about the sound
        // output; only a browser needs a click before it may play audio.
        setProblem({
          message: isTauri()
            ? `The agent sound could not play (${errorMessage(cause, "unknown error")}). Check your sound output, then press Play beside Agent finished in Settings → Notifications.`
            : "Sound could not play. Press Play beside Agent finished in Settings → Notifications to enable audio.",
        });
      });
    };
    const engine = new AttentionEngine({
      focused,
      listed: (id) => windowInFront() && lists.current.has(id),
      preferences: () => ({
        ...getNotificationPreferences(),
        ...(inAppOnly ? { desktop: true } : {}),
      }),
      claim: (id) =>
        claimNotification(
          `${connection.workspace?.machineId ?? connection.endpoint.url}:${connection.workspace?.epoch ?? ""}`,
          id,
        ),
      clear,
      sound,
      show: (notice) => {
        const open = () => {
          if (disposed) return;
          const agent = connection.agents.find((a) => a.id === notice.sessionId);
          if (agent?.attention?.id !== notice.id) return;
          onOpen(notice.sessionId);
          clear(notice.sessionId);
        };
        closes.set(notice.sessionId, { id: notice.id, close: () => undefined });
        if (inAppOnly) return;
        void desktopNotice(notice, open)
          .then((close) => {
            if (disposed || closes.get(notice.sessionId)?.id !== notice.id) close();
            else closes.set(notice.sessionId, { id: notice.id, close });
          })
          .catch(async (cause: unknown) => {
            const access = await notificationAccess().catch(() => "unknown" as const);
            if (disposed || !firstNotificationProblem()) return;
            setProblem(
              // Only macOS has a settings page to open; elsewhere the button could not do anything.
              notificationProblem(
                errorMessage(cause, "unknown error"),
                access,
                isTauri() && isMac(),
              ),
            );
          });
      },
    });
    const noteTerminal = (session: TerminalInfo) => {
      if (session.agentActivity === "working" || session.agentActivity === "needs_input")
        forgetTerminalTurn(session.id);
      else if (session.agentActivity === "idle" && focused(session.id))
        markTerminalTurnSeen(session.id);
    };
    const seen = () => {
      if (
        connection.state.status !== "ready" ||
        !connection.workspace ||
        !connection.state.daemon.capabilities?.includes("agent-attention")
      )
        return;
      for (const session of connection.terminals) noteTerminal(session);
      for (const agent of connection.agents) {
        if (agent.status === "failed" && focused(agent.id)) markFailureSeen(agent);
        const attention = agent.attention;
        if (!attention || attention.seen || !focused(agent.id) || seenRequests.has(attention.id))
          continue;
        engine.viewed(agent.id);
        seenRequests.add(attention.id);
        void connection
          .requestAgent(
            { kind: "seen", sessionId: agent.id, attentionId: attention.id },
            crypto.randomUUID(),
          )
          .then(() => {
            seenRequests.delete(attention.id);
          })
          .catch(() => seenRequests.delete(attention.id));
      }
    };
    acknowledge.current = seen;
    const offAgent = connection.onAgent((event) => {
      if (event.type === "agent.item") return;
      const agents = event.type === "agent.list" ? event.agents : [event.agent];
      const names = paneNames(connection.workspace);
      for (const agent of agents)
        engine.observe(
          // Notifications name an agent the way its renamed pane and the sidebar do.
          { ...agent, name: names.get(agent.id) ?? agent.name },
          live,
          noticePlace(connection.workspace, agent),
        );
      seen();
    });
    const offWorkspace = connection.subscribeWorkspace(() => {
      live = true;
      seen();
    });
    // Agent CLIs in terminals get sounds only; a short settle rides out detection flicker.
    const terminals = new Map(connection.terminals.map((session) => [session.id, session]));
    const terminalSounds = new Map<string, ReturnType<typeof setTimeout>>();
    const offTerminal = connection.onTerminal((event) => {
      if (event.type !== "terminal.state" && event.type !== "terminal.snapshot") return;
      const session = event.session;
      noteTerminal(session);
      const previous = terminals.get(session.id);
      terminals.set(session.id, session);
      if (previous?.agentActivity === session.agentActivity) return;
      clearTimeout(terminalSounds.get(session.id));
      terminalSounds.delete(session.id);
      const kind =
        live && event.type === "terminal.state"
          ? terminalAgentSound(previous, session, focused(session.id))
          : null;
      if (!kind) return;
      terminalSounds.set(
        session.id,
        setTimeout(() => {
          terminalSounds.delete(session.id);
          if (terminals.get(session.id)?.agentActivity !== session.agentActivity) return;
          if (kind === "done" && focused(session.id)) return;
          if (getNotificationPreferences().sound) sound(kind);
        }, 300),
      );
    });
    const stopTerminalSounds = () => {
      for (const timer of terminalSounds.values()) clearTimeout(timer);
      terminalSounds.clear();
    };
    const offState = connection.subscribe((state) => {
      if (state.status !== "ready") {
        live = false;
        engine.suspend();
        stopTerminalSounds();
      }
    });
    document.addEventListener("visibilitychange", seen);
    window.addEventListener("focus", seen);
    const unlock = () => {
      if (getNotificationPreferences().sound) void unlockAudio().catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      disposed = true;
      acknowledge.current = () => undefined;
      engine.dispose();
      stopTerminalSounds();
      offTerminal();
      offAgent();
      offWorkspace();
      offState();
      document.removeEventListener("visibilitychange", seen);
      window.removeEventListener("focus", seen);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [connection, onOpen, inAppOnly]);
  const notice = useMemo(() => ({ problem, dismiss: () => setProblem(null) }), [problem]);
  return (
    <NotificationContext value={{ view, list }}>
      <SidebarNoticeContext value={notice}>{children}</SidebarNoticeContext>
      {!sidebar && problem && (
        <aside
          aria-label="Agent notifications"
          className="fixed top-24 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        >
          <div role="status" className="rounded-lg border bg-card p-3 text-xs shadow-lg">
            {problem.message}
            <div className="mt-2 flex justify-end gap-2">
              {problem.settings && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void openNotificationSettings().catch(() => undefined)}
                >
                  Open System Settings
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setProblem(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </aside>
      )}
    </NotificationContext>
  );
}

const SidebarNoticeContext = createContext<{ problem: Problem | null; dismiss: () => void }>({
  problem: null,
  dismiss: () => undefined,
});

/**
 * "Notifications are off for Concors" and the like, as a card in the sidebar's stack, in the
 * style of the Sign in card: one left edge for the text and the button, the × on the first line.
 */
export function SidebarNotice() {
  const { problem, dismiss } = useContext(SidebarNoticeContext);
  if (!problem) return null;
  return (
    <section role="status" className="mx-2 mb-1 shrink-0 rounded-xl border bg-muted/50 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-foreground">{problem.message}</p>
        {/* One title line tall, so the larger button centres on that line. */}
        <div className="flex h-lh items-center">
          <SidebarTooltip place="above" content="Dismiss">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
              aria-label="Dismiss"
              onClick={dismiss}
            >
              <X className="size-4" />
            </Button>
          </SidebarTooltip>
        </div>
      </div>
      {problem.settings && (
        <div className="mt-3">
          <Button
            variant="outline"
            onClick={() => void openNotificationSettings().catch(() => undefined)}
          >
            Open System Settings
          </Button>
        </div>
      )}
    </section>
  );
}

/** Whether this window is on screen with focus. */
function windowInFront() {
  return document.visibilityState === "visible" && document.hasFocus();
}
