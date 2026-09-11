import { PendingInput } from "./pending-input";
import { ProviderStart } from "./provider-start";
import { AgentAccountPrompt } from "./account-prompt";
import { completedTurnFooters } from "./duration";
import { SessionActions } from "./session-actions";
import { AgentComposer } from "./composer";
import { TimelineItem } from "./timeline-item";
import { useViewedAgent } from "@/notifications/context";
import { CompactLayoutContext, PaneVisibilityContext } from "@/components/compact-layout";
import { useContext, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { AgentOperation, LayoutNode, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Activity } from "./activity";
import { PlanProgress } from "./plan-progress";
import { useAgents } from "./context";
import { useConversation } from "./conversation";
import { useTabVisible } from "@/workspace/tab-visibility";
import { MessageNavigation } from "./message-navigation";
import { useMessageIndex, type MessageEntry } from "./message-index";

const button = "rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40";
export function ChatPane({
  project,
  tab,
  node,
  canEdit,
}: {
  project: WorkspaceProject;
  tab: WorkspaceTab;
  node: Extract<LayoutNode, { kind: "pane" }>;
  canEdit: boolean;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const attempted = useRef(false);
  const startId = useRef(crypto.randomUUID());
  const [provider, setProvider] = useState<string | null>(null);
  const chooseProvider =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("provider-settings");
  const available =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("agent-chat");
  useEffect(() => {
    if (
      (chooseProvider && !provider) ||
      node.sessionId ||
      !canEdit ||
      !available ||
      !connection?.workspace ||
      attempted.current
    )
      return;
    attempted.current = true;
    const current = connection.workspace;
    const currentProject = current.projects.find((item) => item.id === project.id);
    if (!currentProject) return;
    void connection
      .requestAgent(
        {
          kind: "start",
          ...(provider ? { provider } : {}),
          epoch: current.epoch,
          projectId: project.id,
          tabId: tab.id,
          paneId: node.id,
          expectedVersion: currentProject.version,
        },
        startId.current,
      )
      .then((result) => {
        if (result.outcome.status === "error") {
          startId.current = crypto.randomUUID();
          throw new Error(result.outcome.message);
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not prepare agent");
      });
  }, [
    node.sessionId,
    node.id,
    canEdit,
    available,
    connection,
    project.id,
    tab.id,
    retry,
    chooseProvider,
    provider,
  ]);
  if (node.sessionId)
    return <Chat key={node.sessionId} sessionId={node.sessionId} canEdit={canEdit} />;
  if (chooseProvider && !provider)
    return <ProviderStart disabled={!canEdit || !available} onChoose={setProvider} />;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Agent conversation">
      <div className="min-h-0 flex-1" role="log" aria-label="Chat timeline" />
      <div className="shrink-0 px-3 pt-2 pb-3">
        <div className="mx-auto max-w-5xl space-y-3">
          {error && (
            <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
              {error}
              <button
                className={button}
                disabled={!canEdit || !available}
                onClick={() => {
                  attempted.current = false;
                  setError(null);
                  setRetry((value) => value + 1);
                }}
              >
                Retry
              </button>
            </div>
          )}
          <div className="rounded-2xl border bg-background p-2">
            <textarea
              data-agent-composer
              aria-label="Preparing agent"
              placeholder="Preparing agent…"
              disabled
              className="min-h-16 w-full resize-none bg-transparent px-3 py-3 text-[16px] leading-relaxed outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Chat({ sessionId, canEdit }: { sessionId: string; canEdit: boolean }) {
  const compact = useContext(CompactLayoutContext);
  const paneVisible = useContext(PaneVisibilityContext);
  useViewedAgent(sessionId, useTabVisible() && paneVisible);
  const connection = useContext(TerminalConnectionContext);
  const agent = useAgents().find((a) => a.id === sessionId);
  const conversation = useConversation(sessionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const messageIndex = useMessageIndex(
    sessionId,
    agent?.historyRevision ?? 0,
    conversation.ready,
    conversation.items,
  );
  const jumping = useRef(false);
  const jumpToMessage = async (entry: MessageEntry) => {
    follow.current = false;
    jumping.current = true;
    setAtBottom(false);
    try {
      await conversation.reveal(entry.position);
      // Allow React to commit any fetched history before measuring the target.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const viewport = scroll.current;
      const target = viewport?.querySelector<HTMLElement>(
        `[data-user-message="${CSS.escape(entry.id)}"]`,
      );
      if (!viewport || !target) throw new Error("This message is no longer available.");
      const inset = Math.max(
        16,
        Number.parseFloat(getComputedStyle(viewport).scrollPaddingTop) || 0,
      );
      viewport.scrollTop +=
        target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - inset;
      target.focus({ preventScroll: true });
      target.animate([{ backgroundColor: "var(--muted)" }, { backgroundColor: "transparent" }], {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
      });
    } finally {
      requestAnimationFrame(() => {
        jumping.current = false;
      });
    }
  };
  const footers = completedTurnFooters(conversation.items);
  const latestPlan = conversation.items.findLast((item) => item.kind === "plan");
  const proposal = conversation.items.findLast(
    (item) => item.kind === "plan" && item.text.trim() && !item.presentation?.steps?.length,
  );
  const canImplement =
    proposal &&
    proposal.status === "completed" &&
    proposal.turnId === agent?.turnId &&
    agent?.settings?.planMode &&
    agent.supportsPlan &&
    !["working", "starting", "needs_input"].includes(agent.status) &&
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("agent-plan-implementation");
  const active = agent && ["working", "needs_input"].includes(agent.status);
  const connected = canEdit && connection?.state.status === "ready";
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [conversation.items, agent?.pending]);
  useEffect(() => {
    const viewport = scroll.current;
    const content = viewport?.firstElementChild;
    if (!viewport || !content) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const perform = async (operation: AgentOperation, id = crypto.randomUUID()) => {
    if (!connection) throw new Error("Machine is disconnected");
    const result = await connection.requestAgent(operation, id);
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  const pendingInputs = agent?.pending.map((pending) => (
    <PendingInput
      key={pending.id}
      pending={pending}
      disabled={!connected || busy}
      onRespond={(value) =>
        run(() => perform({ kind: "respond", sessionId, pendingId: pending.id, ...value }))
      }
    />
  ));
  const problem = error ?? conversation.error ?? agent?.error;
  const feedback = (
    <>
      {pendingInputs}
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </>
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Agent conversation">
      <div className="chat-timeline-shell relative flex min-h-0 flex-1">
        <div
          ref={scroll}
          role="log"
          aria-label="Chat timeline"
          aria-live="off"
          className="chat-scroll min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-4"
          onScroll={() => {
            const el = scroll.current;
            if (!el) return;
            if (jumping.current) return;
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            setAtBottom(follow.current);
          }}
        >
          <div className="mx-auto max-w-5xl space-y-5">
            {conversation.hasMore && (
              <button
                className={button}
                disabled={busy || !connected}
                onClick={() =>
                  void run(async () => {
                    const el = scroll.current;
                    const height = el?.scrollHeight ?? 0;
                    follow.current = false;
                    await conversation.earlier();
                    requestAnimationFrame(() => {
                      if (el) el.scrollTop += el.scrollHeight - height;
                    });
                  })
                }
              >
                Load earlier messages
              </button>
            )}
            {conversation.items
              .filter((item) => !footers.hidden.has(item.id))
              .map((item) => (
                <div
                  key={item.id}
                  data-user-message={item.kind === "user" ? item.id : undefined}
                  tabIndex={item.kind === "user" ? -1 : undefined}
                  className="outline-none"
                >
                  <TimelineItem item={item} workedFor={footers.durations.get(item.id)} />
                </div>
              ))}
            {compact && feedback}
            {active && (
              <Activity startedAt={agent.turnStartedAt}>
                {agent?.status === "needs_input" ? "Waiting for your input" : "Working…"}
              </Activity>
            )}
          </div>
        </div>
        <MessageNavigation
          entries={messageIndex.entries}
          viewport={scroll}
          onJump={jumpToMessage}
          loading={messageIndex.loading}
          error={messageIndex.error}
          onRetry={messageIndex.retry}
          hasEarlier={
            !(
              connection?.state.status === "ready" &&
              connection.state.daemon.capabilities?.includes("agent-message-navigation")
            ) && conversation.hasMore
          }
          onEarlier={conversation.earlier}
        />
      </div>
      {!atBottom && (
        <button
          className="z-10 mx-auto -mt-9 mb-2 flex items-center gap-1 rounded-xl border bg-background px-3 py-1 text-xs shadow"
          onClick={() => {
            follow.current = true;
            if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
            setAtBottom(true);
          }}
        >
          <ArrowDown className="size-3" />
          Latest
        </button>
      )}
      <div
        data-chat-footer
        className={`${compact ? "" : "max-h-[55%] overflow-y-auto"} shrink-0 px-3 pt-2 pb-3`}
      >
        <div className="mx-auto max-w-5xl space-y-3">
          {!compact && feedback}
          {latestPlan && <PlanProgress compact item={latestPlan} />}
          {canImplement && (
            <button
              className={button}
              disabled={!connected || busy}
              onClick={() =>
                void run(() =>
                  perform({
                    kind: "implement-plan",
                    sessionId,
                    itemId: proposal.id,
                    expectedRevision: agent.revision,
                  }),
                )
              }
            >
              Implement plan
            </button>
          )}
          {agent && <AgentAccountPrompt agent={agent} canEdit={!!connected} />}
          {agent && (
            <>
              <SessionActions agent={agent} items={conversation.items} connected={!!connected} />
              <AgentComposer
                key={agent.id}
                agent={agent}
                connected={!!connected && !busy}
                onInterrupt={() => {
                  if (agent.turnId)
                    void run(() =>
                      perform({ kind: "interrupt", sessionId, turnId: agent.turnId ?? "" }),
                    );
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
