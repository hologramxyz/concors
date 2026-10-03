import {
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { History, LoaderCircle, RefreshCw } from "lucide-react";
import type { AgentInfo, NativeSessionPage } from "@concors/protocol";
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
import {
  cachedSessions,
  cacheSessions,
  knownProviders,
  rememberProviders,
  sessionsFresh,
} from "./session-cache";
import {
  SessionCatalog,
  type ProviderSession,
  type SessionProvider,
  type SessionCatalogSnapshot,
} from "./session-catalog";

/** First pages being fetched, so the availability check and the dialog share one request. */
const pending = new WeakMap<object, Map<string, Promise<NativeSessionPage>>>();

async function listProviders(connection: DaemonConnection) {
  const result = await connection.requestProvider({ kind: "list" }, crypto.randomUUID());
  if (result.outcome.status === "error") throw new Error(result.outcome.message);
  return rememberProviders(connection, result.outcome.providers, result.outcome.revision);
}

function sessionScope(
  connection: DaemonConnection,
  agent: AgentInfo,
  providers: SessionProvider[] | null,
  revision: number,
) {
  return JSON.stringify([
    connection.workspace?.epoch,
    agent.projectId,
    agent.directory,
    providers,
    revision,
  ]);
}

async function readSessions(
  connection: DaemonConnection,
  agent: AgentInfo,
  scope: string,
  provider: string,
  cursor: string | undefined,
  refresh: boolean,
) {
  const key = JSON.stringify([scope, provider, cursor]);
  const cached = !refresh && cachedSessions(connection, key);
  if (cached) return cached;
  let requests = pending.get(connection);
  if (!requests) pending.set(connection, (requests = new Map()));
  const inflight = !refresh && requests.get(key);
  if (inflight) return inflight;
  const request = connection
    .requestProvider(
      {
        kind: "sessions-list",
        projectId: agent.projectId,
        directory: agent.directory,
        provider,
        refresh,
        ...(cursor ? { cursor } : {}),
      },
      crypto.randomUUID(),
    )
    .then((result) => {
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      const page = result.outcome.sessions;
      if (!page) throw new Error("Update this machine's daemon to browse saved sessions.");
      cacheSessions(connection, key, page);
      return page;
    })
    .finally(() => {
      if (requests.get(key) === request) requests.delete(key);
    });
  requests.set(key, request);
  return request;
}

/**
 * Whether the workspace has a saved session other than this chat's own, so an empty chat only
 * offers to resume when there is something to resume. Providers are asked one at a time and
 * the first session found ends the check: listing can mean starting a CLI.
 */
function useHasSessions(connection: DaemonConnection | null, agent: AgentInfo) {
  const [found, setFound] = useState<string | null>(null);
  const check = connection
    ? JSON.stringify([
        connection.workspace?.epoch,
        agent.projectId,
        agent.directory,
        agent.provider,
        agent.threadId,
      ])
    : null;
  useEffect(() => {
    if (!connection || !check) return;
    let current = true;
    void (async () => {
      const { providers, revision } =
        knownProviders.get(connection) ?? (await listProviders(connection));
      const scope = sessionScope(connection, agent, providers, revision);
      for (const provider of providers) {
        const page = await readSessions(connection, agent, scope, provider.id, undefined, false)
          // One provider failing to list must not hide the others' sessions.
          .catch(() => undefined);
        if (!current) return;
        if (page?.sessions.some((s) => provider.id !== agent.provider || s.id !== agent.threadId))
          return setFound(check);
      }
    })().catch(() => undefined);
    return () => {
      current = false;
    };
    // The check key holds every agent field the check reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, check]);
  return !!check && found === check;
}

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
  const available = useHasSessions(connection, agent);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [providers, setProviders] = useState<SessionProvider[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Searching filters what is already loaded, so typing never waits on the machine.
  const search = useDeferredValue(query.trim());
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ id: string; session: ProviderSession; revision: number } | null>(null);
  const changeOpen = (next: boolean) => {
    if (busy) return;
    if (next && !attempt.current) {
      setQuery("");
      setFilter("all");
    }
    // Lists sessions at once from the providers seen last time, by this chat or another.
    const known = next && connection ? knownProviders.get(connection) : undefined;
    if (known) {
      setProviders((value) =>
        JSON.stringify(value) === JSON.stringify(known.providers) ? value : known.providers,
      );
      setRevision(known.revision);
    }
    // A refresh asked for last time must not skip the caches on every later visit.
    if (!next) setRefresh(0);
    setOpen(next);
    onOpenChange(next);
  };
  useEffect(() => () => onOpenChange(false), [onOpenChange]);
  useEffect(() => {
    if (!open || !connection) return;
    let current = true;
    void listProviders(connection)
      .then((next) => {
        if (!current) return;
        setCatalogError(null);
        // Unchanged providers keep the list mounted instead of starting it over.
        setProviders((value) =>
          JSON.stringify(value) === JSON.stringify(next.providers) ? value : next.providers,
        );
        setRevision(next.revision);
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
  const scope = connection ? sessionScope(connection, agent, providers, revision) : "";
  // Nothing to resume hides the button; an open dialog stays until it is closed.
  if (!available && !open) return null;
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
              data-session-filter={provider.id}
              type="button"
              aria-pressed={selected === provider.id}
              disabled={busy || uncertain}
              onClick={() => {
                setFilter(provider.id);
                setError(null);
              }}
              className="inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            >
              {provider.id !== "all" && (
                <span data-session-filter-icon aria-hidden="true" className="shrink-0">
                  <ProviderIcon provider={provider.id} />
                </span>
              )}
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
            key={`${scope}:${refresh}`}
            connection={connection}
            agent={agent}
            providers={providers}
            filter={selected}
            query={search}
            scope={scope}
            refresh={refresh > 0}
            disabled={disabled || busy || uncertain}
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
  // The keyed component owns one load generation; filter and search changes keep its pages.
  const [catalog] = useState(() => {
    const key = (provider: string, cursor?: string) => JSON.stringify([scope, provider, cursor]);
    return new SessionCatalog(
      providers,
      (provider, cursor) => readSessions(connection, agent, scope, provider, cursor, refresh),
      (provider) => {
        // Refresh was asked for, so it shows as loading rather than as the old list.
        const page = !refresh && cachedSessions(connection, key(provider), true);
        return page ? { page, stale: !sessionsFresh(connection, key(provider)) } : undefined;
      },
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
  // A session already chatted with here is listed under the name its pane or tab was given.
  const names = useMemo(
    () =>
      new Map(
        connection.agents.flatMap((a) => {
          const name = a.paneName ?? a.tabName;
          return a.threadId && name ? [[JSON.stringify([a.provider, a.threadId]), name]] : [];
        }),
      ),
    [connection.agents],
  );
  const rows = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    return snapshot.sessions.flatMap((session) => {
      const name = names.get(JSON.stringify([session.provider, session.id]));
      const shown =
        (filter === "all" || session.provider === filter) &&
        (session.provider !== agent.provider || session.id !== agent.threadId) &&
        (!needle ||
          `${name ?? ""} ${session.title} ${session.id}`.toLocaleLowerCase().includes(needle));
      return !shown ? [] : name ? [{ ...session, title: name }] : [session];
    });
  }, [snapshot, names, filter, agent.provider, agent.threadId, query]);
  // Conversations already bound to a pane, looked up once rather than per row.
  const opened = useMemo(() => {
    const panes = new Set(
      connection.workspace?.projects.flatMap((project) =>
        project.tabs.flatMap((tab) =>
          tab.nodes.flatMap((pane) =>
            pane.kind === "pane" && pane.sessionId ? [pane.sessionId] : [],
          ),
        ),
      ),
    );
    return new Set(
      connection.agents
        .filter((a) => a.threadId && panes.has(a.id))
        .map((a) => JSON.stringify([a.provider, a.threadId])),
    );
  }, [connection.agents, connection.workspace]);
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
          const open = opened.has(JSON.stringify([session.provider, session.id]));
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
