import { AgentComposer } from "./composer";
import { TimelineItem } from "./timeline-item";
import { useViewedAgent } from "@/notifications/context";
import { useContext, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type {
  AgentOperation,
  AgentPending,
  LayoutNode,
  WorkspaceProject,
  WorkspaceTab,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Activity } from "./activity";
import { PlanProgress } from "./plan-progress";
import { useAgents } from "./context";
import { useConversation } from "./conversation";

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
  const available =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("agent-chat");
  useEffect(() => {
    if (node.sessionId || !canEdit || !available || !connection?.workspace || attempted.current)
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
  }, [node.sessionId, node.id, canEdit, available, connection, project.id, tab.id, retry]);
  if (node.sessionId)
    return <Chat key={node.sessionId} sessionId={node.sessionId} canEdit={canEdit} />;
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
              aria-label="Message Codex"
              placeholder="Message Codex…"
              disabled
              className="min-h-16 w-full resize-none bg-transparent px-3 py-3 text-[16px] leading-relaxed outline-none"
            />
            <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">
              {!canEdit
                ? "Waiting for an editable connection…"
                : !available
                  ? "Waiting for a machine with agent support…"
                  : error
                    ? "Agent could not be prepared."
                    : "Preparing agent…"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Chat({ sessionId, canEdit }: { sessionId: string; canEdit: boolean }) {
  useViewedAgent(sessionId);
  const connection = useContext(TerminalConnectionContext);
  const agent = useAgents().find((a) => a.id === sessionId);
  const conversation = useConversation(sessionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const latestPlan = conversation.items.findLast((item) => item.kind === "plan");
  const active = agent && ["starting", "working", "needs_input"].includes(agent.status);
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
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Agent conversation">
      <div
        ref={scroll}
        role="log"
        aria-label="Chat timeline"
        aria-live="off"
        className="chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4"
        onScroll={() => {
          const el = scroll.current;
          if (!el) return;
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
          {!conversation.ready && <Activity>Loading conversation…</Activity>}
          {conversation.items.map((item) => (
            <TimelineItem key={item.id} item={item} />
          ))}
          {active && (
            <Activity>
              {agent?.status === "starting"
                ? "Starting agent…"
                : agent?.status === "needs_input"
                  ? "Waiting for your input"
                  : "Working…"}
            </Activity>
          )}
        </div>
      </div>
      {!atBottom && (
        <button
          className="z-10 mx-auto -mt-9 mb-2 flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-xs shadow"
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
      <div className="max-h-[55%] shrink-0 overflow-y-auto px-3 pt-2 pb-3">
        <div className="mx-auto max-w-5xl space-y-3">
          {agent?.pending.map((pending) => (
            <PendingInput
              key={pending.id}
              pending={pending}
              disabled={!connected || busy}
              onRespond={(value) =>
                run(() => perform({ kind: "respond", sessionId, pendingId: pending.id, ...value }))
              }
            />
          ))}
          {(error || conversation.error || agent?.error) && (
            <p role="alert" className="text-xs text-destructive">
              {error ?? conversation.error ?? agent?.error}
            </p>
          )}
          {latestPlan && <PlanProgress compact item={latestPlan} />}
          {agent && (
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
          )}
        </div>
      </div>
    </div>
  );
}
function PendingInput({
  pending,
  disabled,
  onRespond,
}: {
  pending: AgentPending;
  disabled: boolean;
  onRespond: (value: {
    decision?: "accept" | "decline" | "cancel";
    answers?: Record<string, string[]>;
  }) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <section
      aria-label={pending.title}
      className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
    >
      <h3 className="text-sm font-medium">{pending.title}</h3>
      {pending.summary && (
        <p className="text-xs break-words whitespace-pre-wrap">{pending.summary}</p>
      )}
      {pending.kind === "approval" ? (
        <>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Review request details
            </summary>
            <pre className="chat-scroll mt-2 max-h-40 overflow-auto text-[11px] break-words whitespace-pre-wrap">
              {pending.detail}
            </pre>
          </details>
          <div className="flex gap-2">
            {pending.decisions.map((decision) => (
              <button
                key={decision}
                className={button}
                disabled={disabled}
                onClick={() => void onRespond({ decision })}
              >
                {decision === "accept"
                  ? "Allow once"
                  : decision === "decline"
                    ? "Decline"
                    : "Cancel turn"}
              </button>
            ))}
          </div>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onRespond({
              answers: Object.fromEntries(
                pending.questions.map((q) => [q.id, [answers[q.id] ?? ""]]),
              ),
            });
          }}
        >
          {pending.questions.map((q) => (
            <fieldset key={q.id} className="block space-y-2 text-xs">
              <legend>{q.question}</legend>
              {q.options && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((option) => (
                    <button
                      type="button"
                      key={option.label}
                      title={option.description}
                      className={`${button} ${answers[q.id] === option.label ? "border-primary bg-primary/10" : ""}`}
                      disabled={disabled}
                      onClick={() =>
                        setAnswers((current) => ({ ...current, [q.id]: option.label }))
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              <input
                aria-label={q.question}
                type={q.isSecret ? "password" : "text"}
                value={answers[q.id] ?? ""}
                required
                disabled={disabled}
                onChange={(e) => setAnswers((current) => ({ ...current, [q.id]: e.target.value }))}
                className="w-full rounded border bg-background px-2 py-1.5"
              />
            </fieldset>
          ))}
          <button className={button} disabled={disabled}>
            Submit answers
          </button>
        </form>
      )}
    </section>
  );
}
