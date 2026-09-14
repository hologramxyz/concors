import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { History, LoaderCircle, RefreshCw } from "lucide-react";
import type { AgentInfo, NativeSession, ProviderStatus } from "@concors/protocol";
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
import { cachedSessions, cacheSessions, mergeSessions } from "./session-cache";

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
  const [provider, setProvider] = useState(agent.provider);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [revision, setRevision] = useState(0);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{
    id: string;
    session: NativeSession;
    provider: string;
    revision: number;
  } | null>(null);
  const changeOpen = (next: boolean) => {
    if (busy) return;
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
        setProviders(result.outcome.providers.filter((p) => p.enabled && p.installed));
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
  const resume = async (session: NativeSession) => {
    if (!connection || busy || disabled) return;
    setBusy(true);
    setError(null);
    const pending = attempt.current ?? {
      id: crypto.randomUUID(),
      session,
      provider,
      revision: agent.revision,
    };
    attempt.current = pending;
    try {
      const result = await connection.requestAgent(
        {
          kind: "resume-session",
          sessionId: agent.id,
          provider: pending.provider,
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
  const scope = JSON.stringify([
    connection?.workspace?.epoch,
    agent.projectId,
    agent.directory,
    provider,
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
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>Resume session</DialogTitle>
          <DialogDescription>
            Continue a saved conversation from this workspace on this machine. Stop it in your
            terminal first; this does not take over a running CLI.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 gap-2">
          <input
            aria-label="Search sessions"
            placeholder="Search sessions…"
            value={query}
            disabled={busy || uncertain}
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            variant="outline"
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
        </div>
        <label className="relative block min-w-0 text-sm">
          <span className="sr-only">Session provider</span>
          <select
            aria-label="Session provider"
            value={provider}
            disabled={busy || uncertain}
            onChange={(event) => {
              setProvider(event.target.value);
              setError(null);
            }}
            className="w-full min-w-0 rounded-md border bg-background py-2 pr-8 pl-10 text-foreground"
          >
            {!providers.some((p) => p.id === agent.provider) && (
              <option value={agent.provider}>{agent.providerLabel ?? agent.provider}</option>
            )}
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span
            data-session-provider-icon
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center"
          >
            <ProviderIcon provider={provider} />
          </span>
        </label>
        {catalogError && (
          <p role="alert" className="text-xs text-destructive">
            {catalogError}
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
        {connection && open && (
          <SessionResults
            key={scope}
            connection={connection}
            agent={agent}
            provider={provider}
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
  provider,
  query,
  scope,
  refresh,
  disabled,
  onSelect,
}: {
  connection: DaemonConnection;
  agent: AgentInfo;
  provider: string;
  query: string;
  scope: string;
  refresh: boolean;
  disabled: boolean;
  onSelect: (session: NativeSession) => void;
}) {
  const first = cachedSessions(connection, scope);
  const [sessions, setSessions] = useState<NativeSession[]>(first?.sessions ?? []);
  const [cursor, setCursor] = useState<string | null | undefined>(first?.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    if (pending.current || cursor === null) return;
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      const key = cursor ? JSON.stringify([scope, cursor]) : scope;
      let page = cachedSessions(connection, key);
      if (!page) {
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
        page = result.outcome.sessions;
        if (!page) throw new Error("Update this machine's daemon to browse saved sessions.");
        cacheSessions(connection, key, page);
      }
      if (!alive.current) return;
      setSessions((previous) => mergeSessions(previous, page.sessions));
      setCursor(page.nextCursor === cursor ? null : page.nextCursor);
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Could not load sessions");
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  }, [connection, agent.projectId, agent.directory, provider, query, scope, cursor, refresh]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (error || loading || cursor === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void load();
      },
      { root: root.current, rootMargin: "100px" },
    );
    if (sentinel.current) observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [load, error, loading, cursor]);
  const rows = sessions.filter(
    (session) => provider !== agent.provider || session.id !== agent.threadId,
  );
  return (
    <div
      ref={root}
      className="chat-scroll max-h-[45dvh] min-h-0 overflow-y-auto overscroll-contain"
      aria-label="Saved sessions"
    >
      <div className="space-y-1">
        {rows.map((session) => {
          const existing = connection.agents.find(
            (a) => a.provider === provider && a.threadId === session.id,
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
              key={session.id}
              type="button"
              disabled={disabled || session.busy}
              onClick={() => onSelect(session)}
              className="flex w-full min-w-0 flex-col gap-1 rounded-md px-3 py-3 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
            >
              <span className="line-clamp-2 text-sm break-words">
                {session.title.trim() || "Untitled session"}
              </span>
              <span className="text-xs text-muted-foreground">
                <time dateTime={session.updatedAt}>
                  {new Date(session.updatedAt).toLocaleString()}
                </time>
                {open ? " · Already open" : session.busy ? " · Working in another client" : ""}
              </span>
            </button>
          );
        })}
      </div>
      {!rows.length && cursor === null && !error && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {query
            ? "No matching sessions in this workspace."
            : "No saved sessions in this workspace."}
        </p>
      )}
      {error && (
        <div role="alert" className="space-y-2 py-3 text-sm text-destructive">
          <p>{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Retry loading sessions
          </Button>
        </div>
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
