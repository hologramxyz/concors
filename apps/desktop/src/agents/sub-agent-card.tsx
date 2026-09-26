import { useContext, useEffect, useState } from "react";
import { Bot, Check, ChevronRight, X, XCircle } from "lucide-react";
import type { AgentActivityStep, AgentItem } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { BrailleSpinner } from "./activity";
import { useAgents } from "./context";
import { formatDuration } from "./duration";
import { AgentMarkdown, CopyButton } from "./markdown";

const LIVE = ["running", "pending", "inProgress"];

/** Seconds since `since`, ticking while `running`. */
function useElapsed(since: string, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
}

/**
 * A sub-agent a turn started: one quiet row, as a tool call is, naming its kind and task. While
 * it works, the step it is on shows underneath; opening the row lists the steps it took and what
 * it reported back.
 */
export function SubAgentCard({ item, running }: { item: AgentItem; running: boolean }) {
  const [open, setOpen] = useState(false);
  const data = item.presentation;
  const steps = data?.activity ?? [];
  const children = data?.children ?? [];
  const failed = item.status === "failed";
  const elapsed = useElapsed(item.createdAt, running);
  const current = running ? steps.findLast((step) => step.status === "running") : undefined;
  const label = data?.agentType?.trim() || "Sub-agent";
  const summary = [
    steps.length ? `${steps.length} ${steps.length === 1 ? "step" : "steps"}` : null,
    running && elapsed > 0 ? formatDuration(elapsed) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      data-tool-status={item.status}
      data-sub-agent={item.id}
      aria-busy={running}
      aria-label="Sub-agent activity"
      className="overflow-hidden rounded-xl border border-transparent bg-muted/20"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <span className="flex h-5 shrink-0 items-center">
          {running ? (
            <BrailleSpinner />
          ) : failed ? (
            <XCircle className="size-4 text-destructive" />
          ) : (
            <Bot className="size-4 text-muted-foreground" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className={`shrink-0 font-medium ${running ? "agent-shimmer" : ""}`}>
              {label}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-muted-foreground ${running ? "agent-shimmer" : ""}`}
            >
              {item.text}
            </span>
            {summary && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{summary}</span>
            )}
            {(failed || item.status === "interrupted") && (
              <span className="shrink-0 text-xs text-muted-foreground">{item.status}</span>
            )}
            <ChevronRight
              className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
            />
          </span>
          {current && (
            <span
              data-sub-agent-current
              className="truncate text-xs text-muted-foreground"
              title={`${current.title} ${current.text}`}
            >
              {current.title}
              {current.text ? ` · ${current.text}` : ""}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {children.length > 1 ? (
            children.map((child, index) => (
              <section key={child.id} aria-label={`Sub-agent ${index + 1}`} className="space-y-1.5">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  {LIVE.includes(child.status) ? <BrailleSpinner /> : <Bot className="size-3.5" />}
                  Agent {index + 1}
                  <span className="ml-auto">{child.status}</span>
                </p>
                <Steps steps={steps.filter((step) => step.childId === child.id)} />
                <Report
                  item={item}
                  childId={child.id}
                  message={child.message}
                  done={!LIVE.includes(child.status)}
                />
              </section>
            ))
          ) : (
            <>
              <Steps steps={steps} />
              {!steps.length && (
                <p className="text-xs text-muted-foreground">
                  {running ? "Starting…" : "No steps reported."}
                </p>
              )}
              <Report
                item={item}
                childId={children[0]?.id}
                message={children[0]?.message}
                done={!running}
              />
            </>
          )}
        </div>
      )}
    </article>
  );
}

function Steps({ steps }: { steps: readonly AgentActivityStep[] }) {
  if (!steps.length) return null;
  return (
    <ol aria-label="Steps" className="space-y-1 border-l pl-3">
      {steps.map((step) => (
        <li
          key={step.id}
          data-step-status={step.status}
          className="flex min-w-0 items-center gap-2 text-xs"
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            {step.status === "running" ? (
              <BrailleSpinner />
            ) : step.status === "failed" ? (
              <X className="size-3 text-destructive" aria-label="Failed" />
            ) : (
              <Check className="size-3 text-muted-foreground" aria-label="Done" />
            )}
          </span>
          <span className="w-28 shrink-0 truncate font-medium">{step.title}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
            {step.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What the sub-agent reported back, and its whole conversation where the CLI keeps one. */
function Report({
  item,
  childId,
  message,
  done,
}: {
  item: AgentItem;
  childId: string | undefined;
  message: string | null | undefined;
  done: boolean;
}) {
  if (!message && !childId) return null;
  return (
    <div className="space-y-1">
      {message && (
        <>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {done ? "Result" : "Latest update"}
            <CopyButton label="Copy sub-agent report" text={message} />
          </p>
          <div className="text-sm">
            <AgentMarkdown>{message}</AgentMarkdown>
          </div>
        </>
      )}
      {childId && <ChildConversation parent={item} childId={childId} />}
    </div>
  );
}

function ChildConversation({ parent, childId }: { parent: AgentItem; childId: string }) {
  const connection = useContext(TerminalConnectionContext),
    agent = useAgents().find((a) => a.id === parent.sessionId);
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<AgentItem[]>([]),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  if (!agent?.controls?.childHistory) return null;
  const load = async () => {
    if (!connection) return;
    setLoading(true);
    setError(null);
    try {
      const result = await connection.requestAgent(
        { kind: "child-history", sessionId: parent.sessionId, itemId: parent.id, childId },
        crypto.randomUUID(),
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      setItems(result.outcome.childItems ?? []);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not read child session");
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => {
            void load();
          }}
        >
          Open agent conversation
        </button>
      </DialogTrigger>
      <DialogContent size="wide" className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>Agent conversation</DialogTitle>
          <DialogDescription>
            Recent messages from this child agent. Reading them does not send a prompt.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {loading ? (
            <p className="text-sm">Reading conversation…</p>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : items.length ? (
            items.map((item) => (
              <article key={item.id} className="space-y-1 text-sm">
                <p className="text-xs text-muted-foreground">{item.title}</p>
                <AgentMarkdown>{item.text || item.detail}</AgentMarkdown>
              </article>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No messages reported yet.</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
            Reload conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
