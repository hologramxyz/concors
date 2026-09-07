import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonConnection } from "@concors/daemon-client";
import { NotificationContext } from "./context";
import { AttentionEngine, type Notice } from "./engine";
import { claimNotification, getNotificationPreferences } from "./preferences";
import { desktopNotice } from "./platform";
import { playAgentSound, unlockAudio } from "./sound";

export function NotificationProvider({
  connection,
  onOpen,
  children,
}: {
  connection: DaemonConnection | null;
  onOpen: (id: string) => void;
  children: React.ReactNode;
}) {
  const views = useRef(new Map<string, number>());
  const dismiss = useRef<(id: string) => void>(() => undefined);
  const acknowledge = useRef<() => void>(() => undefined);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const view = useCallback((id: string) => {
    views.current.set(id, (views.current.get(id) ?? 0) + 1);
    acknowledge.current();
    return () => {
      const count = views.current.get(id) ?? 0;
      if (count <= 1) views.current.delete(id);
      else views.current.set(id, count - 1);
    };
  }, []);
  useEffect(() => {
    if (!connection) return;
    let disposed = false,
      live = false;
    const closes = new Map<string, { id: string; close: () => void }>();
    const seenRequests = new Set<string>();
    const focused = (id: string) =>
      document.visibilityState === "visible" && document.hasFocus() && views.current.has(id);
    const clear = (id: string) => {
      closes.get(id)?.close();
      closes.delete(id);
      setNotices((current) => current.filter((n) => n.sessionId !== id));
    };
    dismiss.current = clear;
    const engine = new AttentionEngine({
      focused,
      preferences: getNotificationPreferences,
      claim: (id) =>
        claimNotification(
          `${connection.workspace?.machineId ?? connection.endpoint.url}:${connection.workspace?.epoch ?? ""}`,
          id,
        ),
      clear,
      sound: (kind) => {
        void playAgentSound(kind).catch(() => {
          if (!disposed)
            setProblem("Sound could not play. Use Test sound in Settings to enable audio.");
        });
      },
      show: (notice) => {
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
        void desktopNotice(notice, open)
          .then((close) => {
            if (disposed || closes.get(notice.sessionId)?.id !== notice.id) close();
            else closes.set(notice.sessionId, { id: notice.id, close });
          })
          .catch(() => {
            if (!disposed)
              setProblem(
                "Desktop notification could not be shown. Check notification permissions in Settings.",
              );
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
      for (const agent of agents)
        engine.observe(
          agent,
          live,
          connection.workspace?.projects.find((p) => p.id === agent.projectId)?.name ?? "",
        );
      seen();
    });
    const offWorkspace = connection.subscribeWorkspace(() => {
      live = true;
      seen();
    });
    const offState = connection.subscribe((state) => {
      if (state.status !== "ready") {
        live = false;
        engine.suspend();
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
      offAgent();
      offWorkspace();
      offState();
      document.removeEventListener("visibilitychange", seen);
      window.removeEventListener("focus", seen);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [connection, onOpen]);
  return (
    <NotificationContext value={{ view }}>
      {children}
      <aside
        aria-label="Agent notifications"
        className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {notices.map((notice) => (
          <div
            key={notice.id}
            className="flex items-start gap-2 rounded-lg border bg-card p-3 shadow-lg"
          >
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
              <span className="block text-sm font-medium">{notice.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{notice.body}</span>
              <span className="mt-1 block text-xs text-primary">Open conversation</span>
            </button>
            <button
              aria-label="Dismiss notification"
              className="text-muted-foreground"
              onClick={() => dismiss.current(notice.sessionId)}
            >
              ×
            </button>
          </div>
        ))}
        {problem && (
          <div role="status" className="rounded-lg border bg-card p-3 text-xs shadow-lg">
            {problem}
            <button className="ml-2 text-primary" onClick={() => setProblem(null)}>
              Dismiss
            </button>
          </div>
        )}
      </aside>
    </NotificationContext>
  );
}
