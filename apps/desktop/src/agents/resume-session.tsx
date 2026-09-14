import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { History, LoaderCircle, RefreshCw } from "lucide-react";
import type { AgentInfo } from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AgentStartedContext } from "./context";
import { ProviderIcon } from "./provider-icon";
import { cachedSessions, cacheSessions } from "./session-cache";
import {
  SessionCatalog,
  type ProviderSession,
  type SessionProvider,
  type SessionCatalogSnapshot,
} from "./session-catalog";

export function ResumeSession({
  agent,
  disabled,
  onOpenChange,
}: {
  agent: AgentInfo;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const onStarted = useContext(AgentStartedContext);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [providers, setProviders] = useState<SessionProvider[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ id: string; session: ProviderSession; revision: number } | null>(null);
  const changeOpen = (next: boolean) => {
    if (busy) return;
    if (next && !attempt.current) {
      setQuery("");
      setSearch("");
      setFilter("all");
    }
    setOpen(next);
    onOpenChange(next);
  };
  useEffect(() => () => onOpenChange(false), [onOpenChange]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!open || !connection) return;
    let current = true;
    void connection
      .requestProvider({ kind: "list" }, crypto.randomUUID())
      .then((result) => {
        if (!current) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        setCatalogError(null);
        setProviders(
          result.outcome.providers
            .filter((p) => p.enabled && p.installed)
            .map((p) => ({ id: p.id, label: p.label })),
        );
        setRevision(result.outcome.revision);
      })
      .catch((cause: unknown) => {
        if (current)
          setCatalogError(cause instanceof Error ? cause.message : "Could not load providers");
      });
    return () => {
      current = false;
    };
  }, [open, connection, refresh]);
  const resume = async (session: ProviderSession) => {
    if (!connection || busy || disabled) return;
    setBusy(true);
    setError(null);
    const pending = attempt.current ?? {
      id: crypto.randomUUID(),
      session,
      revision: agent.revision,
    };
    attempt.current = pending;
    try {
      const result = await connection.requestAgent(
        {
          kind: "resume-session",
          sessionId: agent.id,
          provider: pending.session.provider,
          nativeSessionId: pending.session.id,
          expectedRevision: pending.revision,
        },
        pending.id,
      );
      if (result.outcome.status === "error") {
        attempt.current = null;
        throw new Error(result.outcome.message);
      }
      attempt.current = null;
      setOpen(false);
      onOpenChange(false);
      onStarted?.(result.outcome.conversation.agent.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resume session");
    } finally {
      setBusy(false);
      setUncertain(!!attempt.current);
    }
  };
  const selected = providers?.some((p) => p.id === filter) ? filter : "all";
  const scope = JSON.stringify([
    connection?.workspace?.epoch,
    agent.projectId,
    agent.directory,
    providers,
    revision,
    search,
    refresh,
  ]);
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" disabled={disabled} className="text-muted-foreground">
          <History className="size-4" /> Resume session
        </Button>
      </DialogTrigger>
      <DialogContent
        className="gap-4"
        headerActions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh sessions"
            disabled={busy || uncertain}
            onClick={() => {
              setError(null);
              setRefresh((value) => value + 1);
            }}
          >
            <RefreshCw className="size-4" />
          </Button>
        }
      >
        <DialogHeader style={{ paddingRight: 88 }}>
          <DialogTitle>Resume session</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Saved conversations in this workspace. Stop a session in its terminal before resuming
          here.
        </DialogDescription>
        <input
          aria-label="Search sessions"
          placeholder="Search sessions…"
          value={query}
          disabled={busy || uncertain}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 shrink-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div
          role="group"
          aria-label="Filter sessions by provider"
          className="flex min-w-0 shrink-0 gap-1 overflow-x-auto pb-1"
        >
          {[{ id: "all", label: "All" }, ...(providers ?? [])].map((provider) => (
            <button
              key={provider.id}
              type="button"
              aria-pressed={selected === provider.id}
              disabled={busy || uncertain}
              onClick={() => {
                setFilter(provider.id);
                setError(null);
              }}
              className="shrink-0 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            >
              {provider.label}
            </button>
          ))}
        </div>
        {catalogError && (
          <p role="alert" className="text-xs text-destructive">
            {catalogError}
          </p>
        )}
        {!providers && !catalogError && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading sessions…
          </p>
        )}
        {providers?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No enabled providers installed on this machine.
          </p>
        )}
        {error && (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            {uncertain && (
              <Button
                variant="outline"
                disabled={busy || disabled}
                onClick={() => {
                  if (attempt.current) void resume(attempt.current.session);
                }}
              >
                Retry resume
              </Button>
            )}
          </div>
        )}
        {connection && open && !!providers?.length && (
          <SessionResults
            key={scope}
            connection={connection}
            agent={agent}
            providers={providers}
            filter={selected}
            query={search}
            scope={scope}
            refresh={refresh > 0}
            disabled={disabled || busy || uncertain || query.trim() !== search}
            onSelect={(session) => void resume(session)}
          />
        )}
        {busy && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Resuming session…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SessionResults({
  connection,
  agent,
  providers,
  filter,
  query,
  scope,
  refresh,
  disabled,
  onSelect,
}: {
  connection: DaemonConnection;
  agent: AgentInfo;
  providers: SessionProvider[];
  filter: string;
  query: string;
  scope: string;
  refresh: boolean;
  disabled: boolean;
  onSelect: (session: ProviderSession) => void;
}) {
  // The keyed component owns one search generation; filter changes keep its loaded pages.
  const [catalog] = useState(() => {
    const key = (provider: string, cursor?: string) => JSON.stringify([scope, provider, cursor]);
    return new SessionCatalog(
      providers,
      async (provider, cursor) => {
        const cached = cachedSessions(connection, key(provider, cursor));
        if (cached) return cached;
        const result = await connection.requestProvider(
          {
            kind: "sessions-list",
            projectId: agent.projectId,
            directory: agent.directory,
            provider,
            query,
            refresh,
            ...(cursor ? { cursor } : {}),
          },
          crypto.randomUUID(),
        );
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        const page = result.outcome.sessions;
        if (!page) throw new Error("Update this machine's daemon to browse saved sessions.");
        cacheSessions(connection, key(provider, cursor), page);
        return page;
      },
      (provider) => cachedSessions(connection, key(provider)),
    );
  });
  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  useEffect(() => {
    catalog.start();
    return catalog.stop;
  }, [catalog]);
  return (
    <SessionList
      key={filter}
      snapshot={snapshot}
      catalog={catalog}
      filter={filter}
      connection={connection}
      agent={agent}
      query={query}
      disabled={disabled}
      onSelect={onSelect}
    />
  );
}

function SessionList({
  snapshot,
  catalog,
  filter,
  connection,
  agent,
  query,
  disabled,
  onSelect,
}: {
  snapshot: SessionCatalogSnapshot;
  catalog: SessionCatalog;
  filter: string;
  connection: DaemonConnection;
  agent: AgentInfo;
  query: string;
  disabled: boolean;
  onSelect: (session: ProviderSession) => void;
}) {
  const [limit, setLimit] = useState(50);
  const root = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const providers = snapshot.providers.filter((p) => filter === "all" || filter === p.id);
  const loading = providers.some((p) => p.loading);
  const more = providers.some((p) => p.hasMore && !p.error);
  const rows = snapshot.sessions.filter(
    (session) =>
      (filter === "all" || session.provider === filter) &&
      (session.provider !== agent.provider || session.id !== agent.threadId),
  );
  useEffect(() => {
    if (limit >= rows.length && (loading || !more)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        if (limit < rows.length) setLimit((value) => value + 50);
        else catalog.loadMore(filter === "all" ? undefined : filter);
      },
      { root: root.current, rootMargin: "100px" },
    );
    if (sentinel.current) observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [catalog, filter, loading, more, limit, rows.length]);
  return (
    <div
      ref={root}
      className="chat-scroll max-h-[45dvh] min-h-0 overflow-y-auto overscroll-contain"
      aria-label="Saved sessions"
    >
      {providers
        .filter((p) => p.error)
        .map((p) => (
          <div key={p.id} role="alert" className="space-y-1 py-2 text-xs text-destructive">
            <p>
              {p.label}: {p.error}
            </p>
            <Button
              variant="outline"
              disabled={p.loading}
              onClick={() => catalog.retry(p.id)}
              aria-label={`Retry ${p.label} sessions`}
            >
              Retry
            </Button>
          </div>
        ))}
      <div className="space-y-1">
        {rows.slice(0, limit).map((session) => {
          const existing = connection.agents.find(
            (a) => a.provider === session.provider && a.threadId === session.id,
          );
          const open =
            existing &&
            connection.workspace?.projects.some((p) =>
              p.tabs.some((tab) =>
                tab.nodes.some((pane) => pane.kind === "pane" && pane.sessionId === existing.id),
              ),
            );
          return (
            <button
              key={JSON.stringify([session.provider, session.id])}
              data-session-provider={session.provider}
              type="button"
              disabled={disabled || session.busy}
              onClick={() => onSelect(session)}
              className="flex w-full min-w-0 items-start gap-3 rounded-md px-3 py-3 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
            >
              <span data-session-provider-icon aria-hidden="true" className="mt-0.5 shrink-0">
                <ProviderIcon provider={session.provider} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="line-clamp-2 text-sm break-words">
                  {session.title.trim() || "Untitled session"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {session.providerLabel} ·{" "}
                  <time dateTime={session.updatedAt}>
                    {new Date(session.updatedAt).toLocaleString()}
                  </time>
                  {open ? " · Already open" : session.busy ? " · Working in another client" : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {!rows.length && !loading && !more && !providers.some((p) => p.error) && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {query
            ? "No matching sessions in this workspace."
            : "No saved sessions in this workspace."}
        </p>
      )}
      <div
        ref={sentinel}
        className="min-h-6 py-1 text-center text-xs text-muted-foreground"
        role="status"
      >
        {loading ? "Loading sessions…" : ""}
      </div>
    </div>
  );
}
