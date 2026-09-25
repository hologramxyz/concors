import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "@concors/protocol";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { ageLabel } from "@/pull-requests/labels";
import { AGENT_STATUS, AgentStartedContext, useAgents } from "./context";
import { ProviderIcon } from "./provider-icon";
import {
  closedChats,
  RESUMABLE_ENGINES,
  searchClosedChats,
  type ClosedChat,
  type ResumableEngine,
} from "./closed-chats";

const ENGINE_LABELS: Record<ResumableEngine, string> = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
};

/**
 * Brings a closed chat back into a tab of its workspace, as it was: its names, agent, model,
 * settings and history all live with the saved agent, so reopening only rebinds a pane to it.
 * This is not the empty chat's "Resume session", which adopts a CLI's own session from disk.
 */
export function ResumeChatDialog({
  open,
  onOpenChange,
  workspace,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceSnapshot | null;
  projectId?: string | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>Resume a chat</DialogTitle>
          <DialogDescription>
            Chats you closed on this machine come back with their name, agent, model, settings and
            history.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ResumeChatContent
            workspace={workspace}
            projectId={projectId}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted with the dialog, so a query or filter never carries over to the next time. */
function ResumeChatContent({
  workspace,
  projectId,
  onClose,
}: {
  workspace: WorkspaceSnapshot | null;
  projectId?: string | undefined;
  onClose: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const onStarted = useContext(AgentStartedContext);
  const agents = useAgents();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"project" | "all">(projectId ? "project" : "all");
  const [engine, setEngine] = useState<ResumableEngine | "all">("all");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const chats = useMemo(() => closedChats(workspace, agents), [workspace, agents]);
  const results = useMemo(
    () =>
      searchClosedChats(
        chats.filter(
          (chat) =>
            (scope === "all" || chat.agent.projectId === projectId) &&
            (engine === "all" || chat.engine === engine),
        ),
        query,
      ).slice(0, 100),
    [chats, scope, projectId, engine, query],
  );
  const selected = Math.min(active, Math.max(results.length - 1, 0));
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  const resume = (chat: ClosedChat) => {
    setError(null);
    if (onStarted) {
      onClose();
      onStarted(chat.agent.id);
      return;
    }
    if (!connection) return;
    void connection
      .requestAgent({ kind: "open-session", sessionId: chat.agent.id }, crypto.randomUUID())
      .then((result) => {
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        onClose();
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not resume the chat"),
      );
  };
  const filter = (pressed: boolean, label: string, onClick: () => void, icon?: ResumableEngine) => (
    <button
      key={label}
      type="button"
      aria-pressed={pressed}
      onClick={() => {
        onClick();
        setActive(0);
      }}
      className="inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground"
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0">
          <ProviderIcon provider={icon} />
        </span>
      )}
      {label}
    </button>
  );
  const option = (index: number) => `${listId}-${index}`;
  return (
    <>
      <input
        autoFocus
        role="combobox"
        aria-label="Search closed chats"
        aria-controls={listId}
        aria-expanded="true"
        aria-activedescendant={results.length ? option(selected) : undefined}
        placeholder="Search by name, agent, model or workspace…"
        value={query}
        maxLength={200}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive(Math.min(Math.max(selected + step, 0), Math.max(results.length - 1, 0)));
          } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            const chat = results[selected];
            if (chat) resume(chat);
          }
        }}
        className="min-w-0 shrink-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex min-w-0 shrink-0 flex-col gap-1">
        <div
          role="group"
          aria-label="Filter closed chats by agent"
          className="flex gap-1 overflow-x-auto"
        >
          {filter(engine === "all", "All agents", () => setEngine("all"))}
          {RESUMABLE_ENGINES.map((id) =>
            filter(engine === id, ENGINE_LABELS[id], () => setEngine(id), id),
          )}
        </div>
        {projectId && (
          <div
            role="group"
            aria-label="Filter closed chats by workspace"
            className="flex gap-1 overflow-x-auto"
          >
            {filter(scope === "project", "This workspace", () => setScope("project"))}
            {filter(scope === "all", "All workspaces", () => setScope("all"))}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Closed chats"
        className="chat-scroll -mx-1 max-h-[50dvh] min-h-0 space-y-1 overflow-y-auto overscroll-contain px-1"
      >
        {results.map((chat, index) => {
          const { agent } = chat;
          const model = agent.settings?.model ?? agent.model;
          const details = [
            agent.providerLabel ?? ENGINE_LABELS[chat.engine],
            agent.models?.find((item) => item.id === model)?.label ?? model,
            scope === "all" ? chat.projectName : null,
          ].filter(Boolean);
          return (
            <div
              key={agent.id}
              id={option(index)}
              role="option"
              aria-selected={index === selected}
              data-index={index}
              data-closed-chat={agent.id}
              onPointerMove={() => setActive(index)}
              onClick={() => resume(chat)}
              className="flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 text-left aria-selected:bg-accent"
            >
              <span aria-hidden="true" className="mt-0.5 shrink-0">
                <ProviderIcon provider={chat.engine} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{chat.title}</span>
                  <time
                    dateTime={agent.updatedAt}
                    title={new Date(agent.updatedAt).toLocaleString()}
                    className="ml-auto shrink-0 text-xs text-muted-foreground"
                  >
                    {ageLabel(agent.updatedAt)}
                  </time>
                </span>
                {chat.title !== agent.name && agent.name.trim() && (
                  <span className="truncate text-xs text-muted-foreground">{agent.name}</span>
                )}
                <span className="truncate text-xs text-muted-foreground">
                  {details.join(" · ")}
                  {["starting", "working", "needs_input"].includes(agent.status)
                    ? ` · ${AGENT_STATUS[agent.status]}`
                    : ""}
                </span>
              </span>
            </div>
          );
        })}
        {!results.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {query.trim()
              ? "No closed chats match your search."
              : scope === "project"
                ? "No closed chats in this workspace yet."
                : "No closed chats on this machine yet."}
          </p>
        )}
      </div>
    </>
  );
}
