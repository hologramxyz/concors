import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  NATIVE_SESSIONS_CAPABILITY,
  nextWorkspaceTabName,
  type AgentInfo,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { ageLabel } from "@/pull-requests/labels";
import { matchScore } from "@/search/index";
import { AgentStartedContext, useAgents } from "./context";
import { ProviderIcon } from "./provider-icon";
import { closedChats } from "./closed-chats";
import { useDiskSessions } from "./disk-sessions";
import { forgetPendingResume, resumeInPane } from "./pending-resume";
import type { ProviderSession } from "./session-catalog";

/**
 * One list of what can come back, newest first: chats closed here, which return as they were
 * (names, agent, model, settings and history), and the CLIs' own older sessions in this
 * workspace's folder, which open in a new chat that takes their history over. A conversation
 * that is both is listed once, as its chat.
 */
export function ResumeChatDialog({
  open,
  onOpenChange,
  workspace,
  projectId,
  execute,
  onTabCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceSnapshot | null;
  projectId?: string | undefined;
  /** Creates the tab a CLI session opens in; without it only closed chats are listed. */
  execute?: ((operation: WorkspaceOperation) => Promise<void>) | undefined;
  /** Shows that new tab, where showing a tab is this client's own choice (the phone). */
  onTabCreated?:
    ((target: { projectId: string; tabId: string; paneId: string }) => void) | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Resume a chat</DialogTitle>
        </DialogHeader>
        {open && (
          <ResumeChatContent
            workspace={workspace}
            projectId={projectId}
            execute={execute}
            onTabCreated={onTabCreated}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface Row {
  key: string;
  title: string;
  /** The agent its icon shows. */
  provider: string;
  updatedAt: string;
  directory: string;
  /** What else a search matches: the agent, model and workspace. */
  detail: string;
  /** A CLI session working in another client cannot be taken over. */
  busy?: boolean;
  pick: () => void;
}

const conversation = (provider: string, threadId: string) => JSON.stringify([provider, threadId]);

/** Mounted with the dialog, so a query never carries over to the next time. */
function ResumeChatContent({
  workspace,
  projectId,
  execute,
  onTabCreated,
  onClose,
}: {
  workspace: WorkspaceSnapshot | null;
  projectId?: string | undefined;
  execute?: ((operation: WorkspaceOperation) => Promise<void>) | undefined;
  onTabCreated?:
    ((target: { projectId: string; tabId: string; paneId: string }) => void) | undefined;
  onClose: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const onStarted = useContext(AgentStartedContext);
  const agents = useAgents();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const project = workspace?.projects.find((item) => item.id === projectId);
  const listsSessions =
    !!execute &&
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(NATIVE_SESSIONS_CAPABILITY);
  const place = useMemo(
    () =>
      listsSessions && project ? { projectId: project.id, directory: project.directory } : null,
    [listsSessions, project],
  );
  const { snapshot, catalog } = useDiskSessions(connection, place);

  const open = (agent: AgentInfo) => {
    setError(null);
    if (onStarted) {
      onClose();
      onStarted(agent.id);
      return;
    }
    if (!connection) return;
    void connection
      .requestAgent({ kind: "open-session", sessionId: agent.id }, crypto.randomUUID())
      .then((result) => {
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        onClose();
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not resume the chat"),
      );
  };
  // A CLI session nobody chatted with here opens in a new tab, whose chat then takes it over.
  const takeOver = (session: ProviderSession) => {
    if (!execute || !project) return;
    setError(null);
    const tabId = crypto.randomUUID();
    const paneId = crypto.randomUUID();
    resumeInPane(paneId, {
      provider: session.provider,
      nativeSessionId: session.id,
    });
    void execute({
      kind: "tab.create",
      projectId: project.id,
      expectedVersion: project.version,
      tabId,
      paneId,
      name: nextWorkspaceTabName(project.tabs),
      profile: "chat",
    })
      .then(() => {
        onTabCreated?.({ projectId: project.id, tabId, paneId });
        onClose();
      })
      .catch((cause: unknown) => {
        forgetPendingResume(paneId);
        setError(cause instanceof Error ? cause.message : "Could not resume the chat");
      });
  };

  const rows = useMemo(() => {
    const closed = closedChats(workspace, agents);
    const projects = new Map(workspace?.projects.map((item) => [item.id, item.name]));
    const listed = new Set(closed.map((chat) => chat.agent.providerGroupId ?? chat.agent.id));
    const chats = new Map(
      agents.flatMap((agent) =>
        agent.threadId ? [[conversation(agent.provider, agent.threadId), agent] as const] : [],
      ),
    );
    const all: Row[] = closed.map((chat) => ({
      key: `chat:${chat.agent.id}`,
      title: chat.title,
      provider: chat.engine,
      updatedAt: chat.agent.updatedAt,
      directory: chat.agent.directory,
      detail: [
        chat.agent.name,
        chat.agent.providerLabel,
        chat.agent.settings?.model ?? chat.agent.model,
        chat.projectName,
      ]
        .filter(Boolean)
        .join(" "),
      pick: () => open(chat.agent),
    }));
    for (const session of snapshot.sessions) {
      const chat = chats.get(conversation(session.provider, session.id));
      // Already a chat here: listed as that chat when closed, and opened where it is when open.
      if (chat && listed.has(chat.providerGroupId ?? chat.id)) continue;
      all.push({
        key: `session:${conversation(session.provider, session.id)}`,
        title: chat?.paneName ?? chat?.tabName ?? (session.title.trim() || "Untitled session"),
        provider: session.provider,
        updatedAt: chat && chat.updatedAt > session.updatedAt ? chat.updatedAt : session.updatedAt,
        directory: session.directory || project?.directory || "",
        detail: [session.providerLabel, project ? projects.get(project.id) : null, session.id]
          .filter(Boolean)
          .join(" "),
        ...(!chat && session.busy ? { busy: true } : {}),
        pick: () => (chat ? open(chat) : takeOver(session)),
      });
    }
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // `open` and `takeOver` only read what the rows are built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, agents, snapshot, project]);
  const results = useMemo(
    () =>
      query.trim() ? rows.filter((row) => matchScore(query, row.title, row.detail) > 0) : rows,
    [rows, query],
  );
  // Rows that would look alike, the same name and agent, add their folder.
  const alike = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of results) {
      const look = JSON.stringify([row.provider, row.title]);
      counts.set(look, (counts.get(look) ?? 0) + 1);
    }
    return (row: Row) => (counts.get(JSON.stringify([row.provider, row.title])) ?? 0) > 1;
  }, [results]);
  const selected = Math.max(
    results.findIndex((row) => row.key === active),
    0,
  );
  const loading = snapshot.providers.some((provider) => provider.loading);
  const more = snapshot.providers.some((provider) => provider.hasMore && !provider.error);
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  // Older CLI sessions are fetched as the list nears its end.
  useEffect(() => {
    if (!catalog || loading || !more) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) catalog.loadMore();
      },
      { root: list.current, rootMargin: "100px" },
    );
    if (sentinel.current) observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [catalog, loading, more]);
  const pick = (row: Row | undefined) => {
    if (row && !row.busy) row.pick();
  };
  const option = (index: number) => `${listId}-${index}`;
  return (
    <>
      <input
        autoFocus
        role="combobox"
        aria-label="Search chats"
        aria-controls={listId}
        aria-expanded="true"
        aria-activedescendant={results.length ? option(selected) : undefined}
        placeholder="Search chats…"
        value={query}
        maxLength={200}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            const next = Math.min(Math.max(selected + step, 0), Math.max(results.length - 1, 0));
            setActive(results[next]?.key ?? null);
          } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            pick(results[selected]);
          }
        }}
        className="min-w-0 shrink-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {snapshot.providers
        .filter((provider) => provider.error)
        .map((provider) => (
          <div
            key={provider.id}
            role="alert"
            className="flex items-center gap-2 text-xs text-destructive"
          >
            <p className="min-w-0 flex-1">
              {provider.label}: {provider.error}
            </p>
            <Button
              variant="outline"
              disabled={provider.loading}
              onClick={() => catalog?.retry(provider.id)}
              aria-label={`Retry ${provider.label}`}
            >
              Retry
            </Button>
          </div>
        ))}
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Chats"
        className="chat-scroll -mx-1 max-h-[50dvh] min-h-0 space-y-1 overflow-y-auto overscroll-contain px-1"
      >
        {results.map((row, index) => (
          <div
            key={row.key}
            id={option(index)}
            role="option"
            aria-selected={index === selected}
            aria-disabled={row.busy || undefined}
            title={row.busy ? "Working in another client" : undefined}
            data-index={index}
            data-resume-row={row.key}
            data-provider={row.provider}
            onPointerMove={() => setActive(row.key)}
            onClick={() => pick(row)}
            className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left aria-disabled:cursor-default aria-disabled:opacity-50 aria-selected:bg-accent"
          >
            <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
              <ProviderIcon provider={row.provider} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{row.title}</span>
              {alike(row) && (
                <span className="truncate text-xs text-muted-foreground">{row.directory}</span>
              )}
            </span>
            <time
              dateTime={row.updatedAt}
              title={new Date(row.updatedAt).toLocaleString()}
              className="shrink-0 text-xs text-muted-foreground"
            >
              {ageLabel(row.updatedAt)}
            </time>
          </div>
        ))}
        {!results.length && !loading && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {query.trim() ? "No chats match your search." : "No chats to resume yet."}
          </p>
        )}
        <div ref={sentinel} aria-hidden="true" className="h-px" />
      </div>
    </>
  );
}
