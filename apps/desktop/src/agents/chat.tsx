import { useViewedAgent } from "@/notifications/context";
import { useContext, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bot, Square, Wrench } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AgentItem,
  AgentOperation,
  AgentPending,
  LayoutNode,
  WorkspaceProject,
  WorkspaceTab,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { AgentStatus } from "./state";
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
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startId = useRef(crypto.randomUUID());
  const available =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("agent-chat");
  if (node.sessionId)
    return <Chat key={node.sessionId} sessionId={node.sessionId} canEdit={canEdit} />;
  const start = async () => {
    if (!connection?.workspace) return;
    setBusy(true);
    setError(null);
    try {
      const result = await connection.requestAgent(
        {
          kind: "start",
          epoch: connection.workspace.epoch,
          projectId: project.id,
          tabId: tab.id,
          paneId: node.id,
          expectedVersion: project.version,
          ...(model.trim() ? { model: model.trim() } : {}),
        },
        startId.current,
      );
      if (result.outcome.status === "error") {
        startId.current = crypto.randomUUID();
        throw new Error(result.outcome.message);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start chat");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <Bot className="size-8 text-primary/70" />
      <div>
        <h2 className="text-sm font-medium">Start a conversation</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Codex works in {project.name}. Your conversation stays with this machine.
        </p>
      </div>
      <label className="flex w-full max-w-64 flex-col gap-1.5 text-left text-xs text-muted-foreground">
        Model
        <input
          aria-label="Chat model"
          placeholder="Use this machine’s default"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={busy}
          className="rounded-md border bg-background px-3 py-2 text-foreground"
        />
      </label>
      <button
        className={button}
        disabled={!canEdit || busy || !available}
        onClick={() => void start()}
      >
        {busy ? "Starting…" : "Start Codex chat"}
      </button>
      {!available && (
        <p className="text-xs text-muted-foreground">
          Update and restart this machine’s daemon to enable unified chat.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function Chat({ sessionId, canEdit }: { sessionId: string; canEdit: boolean }) {
  useViewedAgent(sessionId);
  const connection = useContext(TerminalConnectionContext);
  const agent = useAgents().find((a) => a.id === sessionId);
  const conversation = useConversation(sessionId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<{ id: string; text: string } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const active = agent && ["starting", "working", "needs_input"].includes(agent.status);
  const connected = canEdit && connection?.state.status === "ready";
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [conversation.items, agent?.pending]);
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
  const send = async () => {
    const attempt = uncertain ?? { id: crypto.randomUUID(), text: draft.trim() };
    if (!attempt.text) return;
    setBusy(true);
    setError(null);
    try {
      if (!connection) throw new Error("Machine is disconnected");
      const result = await connection.requestAgent(
        { kind: "send", sessionId, text: attempt.text },
        attempt.id,
      );
      if (result.outcome.status === "error") {
        setUncertain(null);
        setError(result.outcome.message);
        return;
      }
      setUncertain(null);
      setDraft("");
      follow.current = true;
    } catch (cause) {
      setUncertain(attempt);
      setError(cause instanceof Error ? cause.message : "Could not confirm prompt submission");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Agent conversation">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <span className="truncate text-xs text-muted-foreground">
          Codex{agent?.model ? ` · ${agent.model}` : ""}
        </span>
        {agent && <AgentStatus agent={agent} />}
      </div>
      <div
        ref={scroll}
        role="log"
        aria-label="Chat timeline"
        aria-live="off"
        className="chat-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4"
        onScroll={() => {
          const el = scroll.current;
          if (!el) return;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setAtBottom(follow.current);
        }}
      >
        <div className="mx-auto max-w-3xl space-y-5">
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
          {!conversation.ready && (
            <p className="text-xs text-muted-foreground">Loading conversation…</p>
          )}
          {conversation.ready && conversation.items.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              What would you like to work on?
            </p>
          )}
          {conversation.items.map((item) => (
            <TimelineItem key={item.id} item={item} />
          ))}
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
      <div className="max-h-[55%] shrink-0 overflow-y-auto border-t px-4 py-3">
        <div className="mx-auto max-w-3xl space-y-3">
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
          {uncertain && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>Check the conversation before retrying.</span>
              <button className={button} disabled={!connected || busy} onClick={() => void send()}>
                Retry same prompt
              </button>
              <button
                className={button}
                onClick={() => {
                  setUncertain(null);
                  setDraft("");
                  setError(null);
                }}
              >
                Dismiss and review
              </button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!active && !busy && !uncertain) void send();
            }}
            className="rounded-xl border bg-background p-2 shadow-sm"
          >
            <textarea
              aria-label="Message Codex"
              placeholder={active ? "Codex is working…" : "Ask Codex to build something…"}
              value={draft}
              maxLength={16000}
              rows={3}
              disabled={!connected || busy || !!uncertain || !agent?.threadId}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!active && draft.trim() && !busy && !uncertain) void send();
                }
              }}
              className="max-h-48 min-h-16 w-full resize-y bg-transparent px-2 py-1 text-sm outline-none disabled:opacity-50"
            />
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] text-muted-foreground">
                {!connected
                  ? "Reconnecting…"
                  : active
                    ? "You can interrupt this turn"
                    : "Enter to send · Shift+Enter for a new line"}
              </span>
              {active ? (
                <button
                  type="button"
                  aria-label="Interrupt agent"
                  className={button}
                  disabled={
                    !connected || busy || !agent?.turnId || agent.turnId.startsWith("pending:")
                  }
                  onClick={() => {
                    if (agent?.turnId)
                      void run(() =>
                        perform({ kind: "interrupt", sessionId, turnId: agent.turnId ?? "" }),
                      );
                  }}
                >
                  <Square className="size-3" />
                </button>
              ) : (
                <button
                  aria-label="Send message"
                  className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-40"
                  disabled={!connected || busy || !draft.trim() || !!uncertain || !agent?.threadId}
                >
                  <ArrowUp className="size-3.5" />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
function TimelineItem({ item }: { item: AgentItem }) {
  if (item.kind === "tool")
    return (
      <details className="rounded-lg border bg-muted/20 text-xs">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
          <Wrench className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {item.title}: {item.text}
          </span>
          <span
            className={`shrink-0 ${item.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {item.status}
          </span>
        </summary>
        <pre className="chat-scroll max-h-72 overflow-auto border-t p-3 text-[11px] break-words whitespace-pre-wrap">
          {item.detail || "Waiting for tool details…"}
        </pre>
      </details>
    );
  return (
    <article
      className={
        item.kind === "user"
          ? "ml-8 rounded-xl bg-muted/60 px-4 py-3"
          : item.kind === "plan"
            ? "rounded-lg border-l-2 border-primary/40 pl-4"
            : ""
      }
    >
      <p className="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {item.title}
      </p>
      <div className="chat-markdown text-sm leading-relaxed break-words">
        {item.kind === "user" ? (
          <p className="whitespace-pre-wrap">{item.text}</p>
        ) : (
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              img: () => null,
            }}
          >
            {item.text}
          </Markdown>
        )}
      </div>
    </article>
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
