import { PendingInput } from "./pending-input";
import { AgentAccountPrompt } from "./account-prompt";
import { AgentLimitPrompt } from "./limit-prompt";
import { completedTurnFooters } from "./duration";
import { canFork, forkReplies, useForkChat } from "./fork";
import { AgentComposer } from "./composer";
import { TimelineItem } from "./timeline-item";
import { useViewedAgent } from "@/notifications/context";
import { CompactLayoutContext, PaneVisibilityContext } from "@/components/compact-layout";
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, Bot, MessageSquare } from "lucide-react";
import type {
  AgentOperation,
  LayoutNode,
  ProviderStatus,
  WorkspaceProject,
  WorkspaceTab,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Activity } from "./activity";
import { PlanProgress } from "./plan-progress";
import { useAgents } from "./context";
import { useConversation } from "./conversation";
import { ProviderSwitchNotice } from "./provider-switch-notice";
import { useConversationScroll } from "./conversation-scroll";
import { useTabVisible } from "@/workspace/tab-visibility";
import { MessageNavigation } from "./message-navigation";
import { useMessageIndex } from "./message-index";
import { Button } from "@/components/ui/button";
import { NATIVE_SESSIONS_CAPABILITY } from "@concors/protocol";
import { AgentDraftScopeContext, useAgentDraft } from "./draft";
import { ResumeSession } from "./resume-session";
import { rememberProviders } from "./session-cache";
import { ControlPicker } from "./control-picker";
import { ProviderIcon } from "./provider-icon";
import { defaultProvider } from "./default-provider";
import { hasConversation } from "./provider-switch";
import { timelineView } from "./thinking";
import { SubAgentViewContext, type SubAgentTarget } from "./sub-agent-context";
import { SubAgentPanel } from "./sub-agent-view";

export function ChatPane({
  project,
  tab,
  node,
  canEdit,
  start,
}: {
  project: WorkspaceProject;
  tab: WorkspaceTab;
  node: Extract<LayoutNode, { kind: "pane" }>;
  canEdit: boolean;
  /** Shown under the prompt box until the chat's first turn, which centres the box in the pane. */
  start?: ReactNode;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const attempted = useRef(false);
  const startId = useRef(crypto.randomUUID());
  const available =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("agent-chat");
  // A new chat waits for its provider to be chosen; a daemon that cannot list them picks its own.
  const choosesProvider =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes("provider-settings");
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const agents = useAgents();
  const latestAgents = useRef(agents);
  useEffect(() => {
    latestAgents.current = agents;
  });
  useEffect(() => {
    if (node.sessionId || !canEdit || !choosesProvider || !connection) return;
    let current = true;
    void connection
      .requestProvider({ kind: "list" }, crypto.randomUUID())
      .then((result) => {
        if (!current) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        rememberProviders(connection, result.outcome.providers, result.outcome.revision);
        // Subscriptions are accounts of their engine, which every chat on the machine shares.
        const list = result.outcome.providers.filter((p) => p.enabled && !p.subscription);
        setProviders(list);
        // The prompt box is ready at once; its model chip changes the provider before sending.
        setProvider(
          (current) =>
            current ??
            defaultProvider(
              list.filter((p) => p.installed).map((p) => p.id),
              latestAgents.current,
            ),
        );
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : "Could not load providers");
      });
    return () => {
      current = false;
    };
  }, [node.sessionId, canEdit, choosesProvider, connection, retry]);
  useEffect(() => {
    if (
      node.sessionId ||
      !canEdit ||
      !available ||
      !connection?.workspace ||
      attempted.current ||
      (choosesProvider && !provider)
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
          epoch: current.epoch,
          projectId: project.id,
          tabId: tab.id,
          paneId: node.id,
          expectedVersion: currentProject.version,
          ...(provider ? { provider } : {}),
        },
        startId.current,
      )
      .then((result) => {
        if (result.outcome.status === "error") {
          startId.current = crypto.randomUUID();
          // A refused start can be tried with another provider.
          attempted.current = false;
          setProvider(null);
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
    choosesProvider,
    provider,
    connection,
    project.id,
    tab.id,
    retry,
  ]);
  if (node.sessionId)
    return <Chat key={node.sessionId} sessionId={node.sessionId} canEdit={canEdit} start={start} />;
  // Asked only when no provider could be picked: none is installed, or the picked one failed.
  const asking = choosesProvider && !!providers && !provider;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Agent conversation">
      <div className="min-h-0 flex-1" role="log" aria-label="Chat timeline" />
      {start && <StartHeading provider={provider} />}
      <div className="shrink-0 px-[24px] pt-2 pb-3">
        <div className="mx-auto max-w-chat space-y-3">
          {error && (
            <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
              {error}
              <Button
                variant="outline"
                disabled={!canEdit || !available}
                onClick={() => {
                  attempted.current = false;
                  setError(null);
                  setRetry((value) => value + 1);
                }}
              >
                Retry
              </Button>
            </div>
          )}
          <div className="rounded-2xl border bg-background p-2">
            <textarea
              data-agent-composer
              aria-label="Preparing agent"
              placeholder={start ? START_PLACEHOLDER : "Ask your agent to build something…"}
              disabled
              className="agent-composer-input min-h-16 w-full resize-none bg-transparent px-3 py-3 outline-none"
            />
            {asking && (
              <div className="flex items-center gap-1 px-1">
                <ControlPicker
                  label="Providers"
                  showValue
                  value={provider ?? ""}
                  selectedLabel={
                    provider
                      ? (providers?.find((p) => p.id === provider)?.label ?? provider)
                      : "Select a provider"
                  }
                  icon={<Bot className="size-4" />}
                  disabled={!canEdit || !available}
                  options={(providers ?? []).map((p) => ({
                    id: p.id,
                    label: p.label,
                    description: p.installed ? undefined : "Not installed yet",
                    icon: <ProviderIcon provider={p.id} />,
                  }))}
                  onSelect={setProvider}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {start && <StartSpace open>{start}</StartSpace>}
    </div>
  );
}

/** The heading says what the start screen is for, so its prompt box asks more briefly. */
const START_PLACEHOLDER = "Ask anything…";

/** Above the start screen's prompt box: the mark of the provider its chip has selected. */
function StartHeading({ provider }: { provider: string | null }) {
  return (
    // 48px to the prompt box, less the 0.5rem its footer already pads above it.
    <div className="flex shrink-0 flex-col items-center gap-3 px-[24px] pt-2 pb-[calc(48px-0.5rem)] text-muted-foreground">
      {provider ? (
        <ProviderIcon provider={provider} size={40} />
      ) : (
        <MessageSquare className="size-10" aria-hidden="true" />
      )}
      <h2 className="text-lg font-medium text-foreground">What should we build?</h2>
    </div>
  );
}

/**
 * Below the prompt box on the start screen. It is taller than the timeline above, so the column
 * sits a little above the middle of the pane. It holds the other ways to start, which a short
 * pane clips before the prompt box gives up any room, and shrinks away with the first message,
 * easing the box down.
 */
function StartSpace({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`min-h-0 basis-0 overflow-hidden px-[24px] transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none ${open ? "grow-[1.5]" : "grow-0"}`}
    >
      <div className="mx-auto max-w-chat">{children}</div>
    </div>
  );
}

export function Chat({
  sessionId,
  canEdit,
  start,
}: {
  sessionId: string;
  canEdit: boolean;
  start?: ReactNode;
}) {
  const compact = useContext(CompactLayoutContext);
  const paneVisible = useContext(PaneVisibilityContext);
  const visible = useTabVisible() && paneVisible;
  useViewedAgent(sessionId, visible);
  const connection = useContext(TerminalConnectionContext);
  const agent = useAgents().find((a) => a.id === sessionId);
  const conversation = useConversation(sessionId);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(false);
  const draft = useAgentDraft(
    useContext(AgentDraftScopeContext) ?? connection,
    sessionId,
    connection?.workspace?.machineId,
  );
  const [error, setError] = useState<string | null>(null);
  const [subAgent, setSubAgent] = useState<SubAgentTarget | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { scroll, onScroll, atBottom, latest, jumpToMessage } = useConversationScroll(
    conversation,
    visible,
  );
  const messageIndex = useMessageIndex(
    sessionId,
    agent?.historyRevision ?? 0,
    conversation.ready,
    conversation.items,
  );
  const footers = useMemo(() => completedTurnFooters(conversation.items), [conversation.items]);
  const replies = useMemo(() => forkReplies(conversation.items), [conversation.items]);
  const latestReply = conversation.hasNewer
    ? undefined
    : conversation.items.findLast((item) => item.kind === "assistant")?.id;
  const forkChat = useForkChat();
  const view = useMemo(
    () => timelineView(conversation.items, footers.hidden),
    [conversation.items, footers.hidden],
  );
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
  // Nothing was said yet: the pane is still the start screen.
  const fresh = !!agent && !hasConversation(agent) && !conversation.items.length;
  const connected = canEdit && connection?.state.status === "ready";
  const canResume =
    agent &&
    conversation.ready &&
    !conversation.error &&
    !conversation.loading &&
    !conversation.items.length &&
    !conversation.hasEarlier &&
    !conversation.hasNewer &&
    !["starting", "working", "needs_input"].includes(agent.status) &&
    !agent.queue?.length &&
    !agent.pending.length;
  const hasDraft = !!(
    draft.draft ||
    draft.attachments.length ||
    draft.queue.length ||
    draft.busy ||
    draft.uncertain
  );
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
  // Stable across renders so memoized timeline rows only change when forking does.
  const forkAction = useRef<(turnId: string) => void>(() => undefined);
  useLayoutEffect(() => {
    forkAction.current = (turnId) => {
      if (agent) void run(() => forkChat(agent, turnId));
    };
  });
  const forkFrom = useCallback((turnId: string) => forkAction.current(turnId), []);
  const interrupt = () => {
    if (agent?.turnId)
      void run(() => perform({ kind: "interrupt", sessionId, turnId: agent.turnId ?? "" }));
  };
  useEffect(() => {
    if (!visible || !active || !connected || busy || !agent?.turnId) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const pane = root.current?.closest("[data-pane-id]");
      if (!pane?.contains(document.activeElement)) return;
      // Escape dismisses menus, dialogs and shortcut sequences before stopping a turn.
      if (
        document.querySelector(
          ':is([role="dialog"], [role="alertdialog"], [role="menu"]):not([data-state="closed"])',
        )
      )
        return;
      event.preventDefault();
      // Leave propagation intact so an in-progress dictation is canceled too.
      interrupt();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });
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
  // A chat that could not start without its CLI is explained by the install prompt instead.
  const problem = error ?? (installPrompt ? null : agent?.error);
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
    <SubAgentViewContext value={agent?.controls?.childHistory ? setSubAgent : null}>
      <div ref={root} className="chat-with-sub-agent relative flex min-h-0 min-w-0 flex-1">
        <div
          // A size container, so the composer can size its text box to the pane, not the window.
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${compact ? "" : "[container-type:size]"}`}
          aria-label="Agent conversation"
        >
          <div className="chat-timeline-shell relative flex min-h-0 flex-1">
            <div
              ref={scroll}
              role="log"
              aria-label="Chat timeline"
              aria-live="off"
              className={`chat-scroll selectable min-h-0 min-w-0 flex-1 overflow-y-auto ${compact ? "px-3" : "px-[24px]"} py-4 [overflow-anchor:none]`}
              onScroll={onScroll}
            >
              <div className="mx-auto max-w-chat space-y-5">
                {canResume && agent && (
                  <ProviderSwitchNotice agent={agent} disabled={!connected || busy} />
                )}
                {/* The start screen offers nothing but the prompt box and its chips. */}
                {canResume &&
                  !start &&
                  connection?.state.status === "ready" &&
                  connection.state.daemon.capabilities?.includes(NATIVE_SESSIONS_CAPABILITY) && (
                    <div className="flex justify-center py-6">
                      <ResumeSession
                        agent={agent}
                        disabled={!connected || busy || hasDraft}
                        onOpenChange={setResuming}
                      />
                    </div>
                  )}
                {agent?.nativeImport &&
                  agent.status === "starting" &&
                  !conversation.items.length &&
                  !conversation.loading && (
                    // A resumed session's history arrives once its CLI has loaded it, as one page.
                    <p className="py-6 text-center text-xs text-muted-foreground" role="status">
                      Loading conversation…
                    </p>
                  )}
                {(conversation.hasEarlier || conversation.loading === "latest") && (
                  <div className="h-5 text-center text-xs text-muted-foreground" role="status">
                    {conversation.loading === "earlier"
                      ? "Loading earlier messages…"
                      : conversation.loading === "latest"
                        ? "Loading messages…"
                        : ""}
                  </div>
                )}
                {conversation.error && conversation.error.direction !== "newer" && (
                  <HistoryError
                    message={conversation.error.message}
                    onRetry={() =>
                      void conversation.load(conversation.error?.direction ?? "latest")
                    }
                  />
                )}
                {view.map((item) => (
                  <div
                    key={item.id}
                    data-message-id={item.id}
                    data-message-position={item.position}
                    data-user-message={item.kind === "user" ? item.id : undefined}
                    tabIndex={item.kind === "user" ? -1 : undefined}
                    className="outline-none"
                  >
                    <TimelineItem
                      item={item}
                      workedFor={footers.durations.get(item.id)}
                      live={!!active && item.turnId === agent.turnId}
                      onFork={
                        connected &&
                        !busy &&
                        canFork(agent) &&
                        replies.has(item.id) &&
                        (agent.controls?.forkFromTurn || item.id === latestReply)
                          ? forkFrom
                          : undefined
                      }
                    />
                  </div>
                ))}
                {conversation.hasNewer && (
                  <div className="h-5 text-center text-xs text-muted-foreground" role="status">
                    {conversation.loading === "newer" ? "Loading newer messages…" : ""}
                  </div>
                )}
                {conversation.error?.direction === "newer" && (
                  <HistoryError
                    message={conversation.error.message}
                    onRetry={() => void conversation.load("newer")}
                  />
                )}
                {compact && feedback}
                {active && !conversation.hasNewer && (
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
                ) && conversation.hasEarlier
              }
              hasNewer={conversation.hasNewer}
            />
            {/* Floats so showing it never resizes the timeline under a pinned reader. */}
            {!atBottom && (
              <Button
                variant="outline"
                className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 shadow"
                onClick={latest}
              >
                <ArrowDown className="size-3" />
                Latest
              </Button>
            )}
          </div>
          {start && fresh && <StartHeading provider={agent.provider} />}
          <div
            data-chat-footer
            // In a short pane the timeline gives up its room first. Prompts and notices above the
            // composer scroll before the composer itself loses any of its height.
            className={`${compact ? "px-3" : "flex max-h-[min(100%,max(55%,12rem))] flex-col px-[24px]"} shrink-0 pt-2 pb-3`}
          >
            <div className="mx-auto flex min-h-0 w-full max-w-chat flex-col gap-3">
              <div className="min-h-0 space-y-3 overflow-y-auto empty:hidden">
                {!compact && feedback}
                {latestPlan && <PlanProgress compact item={latestPlan} />}
                {canImplement && (
                  <Button
                    variant="outline"
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
                  </Button>
                )}
                {agent && (
                  <AgentAccountPrompt
                    agent={agent}
                    canEdit={!!connected}
                    onInstallPrompt={setInstallPrompt}
                  />
                )}
                {agent && <AgentLimitPrompt agent={agent} canEdit={!!connected} />}
              </div>
              {agent && (
                <AgentComposer
                  key={agent.id}
                  agent={agent}
                  connected={!!connected && !busy && !resuming}
                  reachable={connection?.state.status === "ready"}
                  onSend={latest}
                  onInterrupt={interrupt}
                  placeholder={start && fresh ? START_PLACEHOLDER : undefined}
                />
              )}
            </div>
          </div>
          {start && <StartSpace open={fresh}>{fresh && start}</StartSpace>}
        </div>
        {subAgent && (
          <SubAgentPanel
            key={`${subAgent.item.id}:${subAgent.childId}`}
            sessionId={sessionId}
            target={subAgent}
            item={conversation.items.find((item) => item.id === subAgent.item.id)}
            turnActive={!!active}
            onClose={() => setSubAgent(null)}
          />
        )}
      </div>
    </SubAgentViewContext>
  );
}

function HistoryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-center gap-2 text-xs text-destructive">
      {message}
      <Button variant="outline" onClick={onRetry}>
        Retry loading messages
      </Button>
    </div>
  );
}
