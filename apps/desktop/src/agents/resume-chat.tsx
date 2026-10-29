import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  NATIVE_SESSIONS_CAPABILITY,
  nextWorkspaceTabName,
  type AgentInfo,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { ageLabel } from "@/pull-requests/labels";
import { matchScore } from "@/search/index";
import { AgentStartedContext, useAgents } from "./context";
import { ProviderIcon } from "./provider-icon";
import { closedChats, RESUMABLE_ENGINES, type ResumableEngine } from "./closed-chats";
import { useDiskSessions, type PlacedSession, type SessionPlace } from "./disk-sessions";
import { forgetPendingResume, resumeInPane } from "./pending-resume";

/**
 * One list of what can come back, newest first: chats closed here, which return as they were
 * (names, agent, model, settings and history), and the CLIs' own older sessions in the
 * workspaces' folders, which open in a new chat that takes their history over. A conversation
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

const ENGINE_LABELS: Record<ResumableEngine, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};
const ENGINE_ORDER = ["claude", "codex", "opencode"] as const satisfies readonly ResumableEngine[];

interface Row {
  key: string;
  title: string;
  /** The agent its icon shows. */
  provider: string;
  updatedAt: string;
  projectId: string;
  /** What else a search matches: the agent, model and workspace. */
  detail: string;
  /** A CLI session working in another client cannot be taken over. */
  busy?: boolean;
  pick: () => void;
}

const conversation = (provider: string, threadId: string) => JSON.stringify([provider, threadId]);

/** A compact dropdown of the filter row, showing its choice. */
function FilterMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  /** A null entry draws a divider. */
  options: ({ id: string; label: string; icon?: React.ReactNode } | null)[];
  onChange: (id: string) => void;
}) {
  const current = options.find((option) => option?.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          className="min-w-0 text-muted-foreground"
        >
          {current?.icon}
          <span className="truncate">{current?.label}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto max-w-72 min-w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option, index) =>
            option ? (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                {option.icon}
                <span className="truncate">{option.label}</span>
              </DropdownMenuRadioItem>
            ) : (
              <DropdownMenuSeparator key={`divider-${index}`} />
            ),
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mounted with the dialog, so a query or filter never carries over to the next time. */
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
  // "this", "all", or a workspace's ID.
  const [scope, setScope] = useState(projectId ? "this" : "all");
  const [engine, setEngine] = useState<ResumableEngine | "all">("all");
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const projects = useMemo(() => workspace?.projects ?? [], [workspace]);
  const shownProject = scope === "this" ? projectId : scope === "all" ? null : scope;
  const listsSessions =
    !!execute &&
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(NATIVE_SESSIONS_CAPABILITY);
  // The folders listed for CLI sessions: the workspace shown, or every workspace's, each once.
  const places = useMemo(() => {
    if (!listsSessions) return [];
    const shown = shownProject
      ? projects.filter((item) => item.id === shownProject)
      : [...projects].sort((a, b) => Number(b.id === projectId) - Number(a.id === projectId));
    const seen = new Set<string>();
    return shown.flatMap((item): SessionPlace[] => {
      if (seen.has(item.directory)) return [];
      seen.add(item.directory);
      return [{ projectId: item.id, directory: item.directory }];
    });
  }, [listsSessions, shownProject, projects, projectId]);
  const disk = useDiskSessions(connection, places);

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
  // A CLI session nobody chatted with here opens in a new tab of its folder's workspace, whose
  // chat then takes it over.
  const takeOver = (session: PlacedSession) => {
    const target = projects.find((item) => item.id === session.place.projectId);
    if (!execute || !target) return;
    setError(null);
    const tabId = crypto.randomUUID();
    const paneId = crypto.randomUUID();
    resumeInPane(paneId, { provider: session.provider, nativeSessionId: session.id });
    void execute({
      kind: "tab.create",
      projectId: target.id,
      expectedVersion: target.version,
      tabId,
      paneId,
      name: nextWorkspaceTabName(target.tabs),
      profile: "chat",
    })
      .then(() => {
        onTabCreated?.({ projectId: target.id, tabId, paneId });
        onClose();
      })
      .catch((cause: unknown) => {
        forgetPendingResume(paneId);
        setError(cause instanceof Error ? cause.message : "Could not resume the chat");
      });
  };

  const rows = useMemo(() => {
    const closed = closedChats(workspace, agents);
    const names = new Map(projects.map((item) => [item.id, item.name]));
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
      projectId: chat.agent.projectId,
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
    const seen = new Set<string>();
    for (const session of disk.sessions) {
      const id = conversation(session.provider, session.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const chat = chats.get(id);
      // Already a chat here: listed as that chat when closed, and opened where it is when open.
      if (chat && listed.has(chat.providerGroupId ?? chat.id)) continue;
      all.push({
        key: `session:${id}`,
        title: chat?.paneName ?? chat?.tabName ?? (session.title.trim() || "Untitled session"),
        provider: session.provider,
        updatedAt: chat && chat.updatedAt > session.updatedAt ? chat.updatedAt : session.updatedAt,
        projectId: chat?.projectId ?? session.place.projectId,
        detail: [session.providerLabel, names.get(session.place.projectId), session.id]
          .filter(Boolean)
          .join(" "),
        ...(!chat && session.busy ? { busy: true } : {}),
        pick: () => (chat ? open(chat) : takeOver(session)),
      });
    }
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // `open` and `takeOver` only read what the rows are built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, agents, disk.sessions, projects]);
  const results = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!shownProject || row.projectId === shownProject) &&
          (engine === "all" || row.provider === engine) &&
          (!query.trim() || matchScore(query, row.title, row.detail) > 0),
      ),
    [rows, shownProject, engine, query],
  );
  const workspaceName = (id: string) => projects.find((item) => item.id === id)?.name ?? "";
  const selected = Math.max(
    results.findIndex((row) => row.key === active),
    0,
  );
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  // Older CLI sessions are fetched as the list nears its end.
  const { loading, more, loadMore } = disk;
  useEffect(() => {
    if (loading || !more) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { root: list.current, rootMargin: "100px" },
    );
    if (sentinel.current) observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [loading, more, loadMore]);
  const pick = (row: Row | undefined) => {
    if (row && !row.busy) row.pick();
  };
  const option = (index: number) => `${listId}-${index}`;
  const others = projects.filter((item) => item.id !== projectId);
  return (
    <>
      <div className="flex min-w-0 shrink-0 flex-col gap-2">
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
          className="min-w-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="-ml-2 flex min-w-0 items-center gap-1">
          <FilterMenu
            label="Workspace"
            value={scope}
            onChange={(id) => {
              setScope(id);
              setActive(null);
            }}
            options={[
              ...(projectId ? [{ id: "this", label: "This workspace" }] : []),
              { id: "all", label: "All workspaces" },
              ...(others.length ? [null] : []),
              ...others.map((item) => ({ id: item.id, label: item.name })),
            ]}
          />
          <FilterMenu
            label="Agent"
            value={engine}
            onChange={(id) => {
              setEngine(id as ResumableEngine | "all");
              setActive(null);
            }}
            options={[
              { id: "all", label: "All agents" },
              ...ENGINE_ORDER.filter((id) => RESUMABLE_ENGINES.includes(id)).map((id) => ({
                id,
                label: ENGINE_LABELS[id],
                icon: (
                  <span aria-hidden="true" className="flex size-4 items-center justify-center">
                    <ProviderIcon provider={id} />
                  </span>
                ),
              })),
            ]}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {disk.errors.map((item) => (
        <div
          key={item.key}
          role="alert"
          className="flex items-center gap-2 text-xs text-destructive"
        >
          <p className="min-w-0 flex-1">
            {item.label}: {item.error}
          </p>
          <Button
            variant="outline"
            disabled={item.loading}
            onClick={item.retry}
            aria-label={`Retry ${item.label}`}
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
              {scope === "all" && (
                <span className="truncate text-xs text-muted-foreground">
                  {workspaceName(row.projectId)}
                </span>
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
          <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
            <p>{query.trim() ? "No chats match your search." : "No closed chats here"}</p>
            {scope !== "all" && (
              <Button
                variant="outline"
                onClick={() => {
                  setScope("all");
                  setActive(null);
                }}
              >
                Show all workspaces
              </Button>
            )}
          </div>
        )}
        <div ref={sentinel} aria-hidden="true" className="h-px" />
      </div>
    </>
  );
}
