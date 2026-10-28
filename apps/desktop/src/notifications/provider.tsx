import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { ProjectIcon } from "@concors/protocol";
import { NotificationContext } from "./context";
import { AttentionEngine, type Notice } from "./engine";
import { claimNotification, getNotificationPreferences } from "./preferences";
import { countdown } from "./countdown";
import { desktopNotice, notificationAccess, openNotificationSettings } from "./platform";
import { errorMessage } from "./access";
import { isTauri } from "@/tauri";
import { Button } from "@/components/ui/button";
import { playAgentSound, unlockAudio } from "./sound";
import { terminalAgentSound } from "./terminal";
import { agentPane, paneNames } from "@/agents/visible-sessions";
import { ProjectImage } from "@/workspace/project-image";
import { projectIconKey, projectIcons } from "@/workspace/project-icons";

/** How long an unanswered card stays readable, as long as a macOS or Windows banner does. */
const CARD_TIMEOUT_MS = 5_000;

export function NotificationProvider({
  connection,
  onOpen,
  children,
  inAppOnly = false,
  cards = true,
}: {
  connection: DaemonConnection | null;
  onOpen: (id: string) => void;
  children: React.ReactNode;
  inAppOnly?: boolean;
  /**
   * Show a card for each notice. Mobile does not, as Paseo does not: a phone has no room for
   * small pop-ups, and the Agents list already marks what finished or needs input.
   */
  cards?: boolean;
}) {
  const views = useRef(new Map<string, number>());
  const dismiss = useRef<(id: string) => void>(() => undefined);
  const acknowledge = useRef<() => void>(() => undefined);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [problem, setProblem] = useState<{ message: string; settings?: boolean } | null>(null);
  const view = useCallback((id: string) => {
    views.current.set(id, (views.current.get(id) ?? 0) + 1);
    acknowledge.current();
    return () => {
      const count = views.current.get(id) ?? 0;
      if (count <= 1) views.current.delete(id);
      else views.current.set(id, count - 1);
    };
  }, []);
  // Only the card goes: the agent stays unread and its OS notification stays in the list.
  const expire = useCallback((id: string) => {
    setNotices((current) => current.filter((n) => n.id !== id));
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
      setNotices((current) => current.filter((n) => n.sessionId !== id));
    };
    dismiss.current = clear;
    const sound = (kind: Notice["kind"]) => {
      void playAgentSound(kind).catch((cause: unknown) => {
        if (disposed) return;
        // The desktop app plays through the system, so a failure there is about the sound
        // output; only a browser needs a click before it may play audio.
        setProblem({
          message: isTauri()
            ? `The agent sound could not play (${errorMessage(cause, "unknown error")}). Check your sound output, then use Test completion sound in Settings → Notifications.`
            : "Sound could not play. Use Test completion sound in Settings → Notifications to enable audio.",
        });
      });
    };
    const engine = new AttentionEngine({
      focused,
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
        if (cards)
          setNotices((current) =>
            [...current.filter((n) => n.sessionId !== notice.sessionId), notice].slice(-5),
          );
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
            const access = await notificationAccess().catch(() => "unknown");
            if (disposed) return;
            setProblem({
              message: `A desktop notification could not be shown: ${errorMessage(cause, "unknown error")}`,
              settings: isTauri() && (access === "blocked" || access === "quiet"),
            });
          });
      },
    });
    const seen = () => {
      if (
        connection.state.status !== "ready" ||
        !connection.workspace ||
        !connection.state.daemon.capabilities?.includes("agent-attention")
      )
        return;
      for (const agent of connection.agents) {
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
      for (const agent of agents) {
        const pane = agentPane(connection.workspace, agent.id);
        engine.observe(
          // Notifications name an agent the way its renamed pane and the sidebar do.
          { ...agent, name: names.get(agent.id) ?? agent.name },
          live,
          {
            projectId: agent.projectId,
            workspace:
              connection.workspace?.projects.find((p) => p.id === agent.projectId)?.name ?? "",
            tab: pane?.tab.name ?? "",
          },
        );
      }
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
      dismiss.current = () => undefined;
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
  }, [connection, onOpen, inAppOnly, cards]);
  return (
    <NotificationContext value={{ view }}>
      {children}
      <aside
        aria-label="Agent notifications"
        className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {notices.map((notice) => (
          <NoticeCard key={notice.id} id={notice.id} onExpire={expire}>
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (
                  connection?.agents.find((a) => a.id === notice.sessionId)?.attention?.id ===
                  notice.id
                )
                  onOpen(notice.sessionId);
                dismiss.current(notice.sessionId);
              }}
            >
              {notice.place.workspace && (
                <span
                  data-notice-place
                  className="mb-1.5 flex min-w-0 items-center gap-1.5 text-xs"
                  title={[notice.place.workspace, notice.place.tab].filter(Boolean).join(" › ")}
                >
                  <NoticeWorkspaceIcon connection={connection} notice={notice} />
                  <span className="truncate font-semibold text-foreground">
                    {notice.place.workspace}
                  </span>
                  {notice.place.tab && (
                    <>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate text-muted-foreground">{notice.place.tab}</span>
                    </>
                  )}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full ${notice.kind === "done" ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                {notice.kind === "done" ? "Agent finished" : "Agent needs input"}
              </span>
              <span
                className="line-clamp-2 text-xs break-words text-muted-foreground"
                title={notice.agent}
              >
                {notice.agent}
              </span>
              <span className="mt-1 block text-xs text-primary">Open conversation</span>
            </button>
            <button
              aria-label="Dismiss notification"
              className="text-muted-foreground"
              onClick={() => dismiss.current(notice.sessionId)}
            >
              ×
            </button>
          </NoticeCard>
        ))}
        {problem && (
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
        )}
      </aside>
    </NotificationContext>
  );
}

/** Whether this window is on screen with focus, which is when its cards can be read. */
function windowInFront() {
  return document.visibilityState === "visible" && document.hasFocus();
}
function subscribeWindow(listener: () => void) {
  window.addEventListener("focus", listener);
  window.addEventListener("blur", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
    document.removeEventListener("visibilitychange", listener);
  };
}

/**
 * A card that goes away by itself once it has been readable for `CARD_TIMEOUT_MS`: the window in
 * front, and neither the pointer nor keyboard focus on the card, as toasts pause.
 */
function NoticeCard({
  id,
  onExpire,
  children,
}: {
  id: string;
  onExpire: (id: string) => void;
  children: React.ReactNode;
}) {
  const [run] = useState(() => countdown(CARD_TIMEOUT_MS));
  const front = useSyncExternalStore(subscribeWindow, windowInFront);
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const running = front && !pointer && !focus;
  useEffect(() => (running ? run(() => onExpire(id)) : undefined), [run, running, onExpire, id]);
  return (
    <div
      className="flex items-start gap-2 rounded-lg border bg-card p-3 shadow-lg"
      onPointerEnter={() => setPointer(true)}
      onPointerLeave={() => setPointer(false)}
      onFocus={() => setFocus(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocus(false);
      }}
    >
      {children}
    </div>
  );
}

/** The workspace's own icon, so cards from different workspaces look different at a glance. */
function NoticeWorkspaceIcon({
  connection,
  notice,
}: {
  connection: DaemonConnection | null;
  notice: Notice;
}) {
  const cache = connection ? projectIcons(connection) : null;
  const icons = useSyncExternalStore(
    cache?.subscribe ?? noSubscription,
    cache?.getSnapshot ?? noIcons,
  );
  const workspace = connection?.workspace;
  const project = workspace?.projects.find((p) => p.id === notice.place.projectId);
  const icon =
    project && workspace ? icons.get(projectIconKey(workspace.epoch, project)) : undefined;
  return (
    <ProjectImage
      source={icon?.source ?? null}
      isGit={icon?.isGit ?? false}
      name={notice.place.workspace}
      size={16}
    />
  );
}
const empty = new Map<string, ProjectIcon>();
const noIcons = () => empty;
const noSubscription = () => () => undefined;
