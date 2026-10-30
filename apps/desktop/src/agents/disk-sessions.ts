import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { NativeSessionPage } from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";
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
  type SessionCatalogSnapshot,
  type SessionProvider,
} from "./session-catalog";

/** A folder whose CLI sessions are listed, and the workspace a resumed one opens in. */
export interface SessionPlace {
  projectId: string;
  directory: string;
}

/** First pages being fetched, so two lists open at once share one request. */
const pending = new WeakMap<object, Map<string, Promise<NativeSessionPage>>>();

async function listProviders(connection: DaemonConnection) {
  const result = await connection.requestProvider({ kind: "list" }, crypto.randomUUID());
  if (result.outcome.status === "error") throw new Error(result.outcome.message);
  return rememberProviders(connection, result.outcome.providers, result.outcome.revision);
}

async function readSessions(
  connection: DaemonConnection,
  place: SessionPlace,
  scope: string,
  provider: string,
  cursor: string | undefined,
) {
  const key = JSON.stringify([scope, provider, cursor]);
  const cached = cachedSessions(connection, key);
  if (cached) return cached;
  let requests = pending.get(connection);
  if (!requests) pending.set(connection, (requests = new Map()));
  const inflight = requests.get(key);
  if (inflight) return inflight;
  const request = connection
    .requestProvider(
      {
        kind: "sessions-list",
        projectId: place.projectId,
        directory: place.directory,
        provider,
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

/** One snapshot for several catalogs, a new array only when one of theirs changes. */
function combine(catalogs: SessionCatalog[]) {
  let last: SessionCatalogSnapshot[] = [];
  return {
    subscribe: (listener: () => void) => {
      const offs = catalogs.map((catalog) => catalog.subscribe(listener));
      return () => {
        for (const off of offs) off();
      };
    },
    getSnapshot: () => {
      const parts = catalogs.map((catalog) => catalog.getSnapshot());
      if (parts.length !== last.length || parts.some((part, index) => part !== last[index]))
        last = parts;
      return last;
    },
  };
}

/** A CLI session, with the folder it was listed for. */
export interface PlacedSession extends ProviderSession {
  place: SessionPlace;
}
export interface DiskSessions {
  sessions: PlacedSession[];
  loading: boolean;
  /** Older sessions remain to be fetched. */
  more: boolean;
  errors: { key: string; label: string; error: string; loading: boolean; retry: () => void }[];
  loadMore: () => void;
}

/**
 * The CLIs' own saved sessions in each of `places`, from every installed provider, filled in
 * page by page as each provider answers. Sessions seen before show at once and refresh quietly:
 * listing can mean starting a CLI.
 */
export function useDiskSessions(
  connection: DaemonConnection | null,
  places: readonly SessionPlace[],
): DiskSessions {
  const [providers, setProviders] = useState<{
    providers: SessionProvider[];
    revision: number;
  } | null>(() => (connection && knownProviders.get(connection)) || null);
  const wanted = places.length > 0;
  useEffect(() => {
    if (!connection || !wanted) return;
    let current = true;
    void listProviders(connection)
      .then((next) => {
        // Unchanged providers keep the lists as they are instead of starting them over.
        if (current)
          setProviders((value) => (JSON.stringify(value) === JSON.stringify(next) ? value : next));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [connection, wanted]);
  const key = JSON.stringify([connection?.workspace?.epoch, places, providers]);
  const catalogs = useMemo(() => {
    if (!connection || !providers) return [];
    return places.map((place) => {
      const scope = JSON.stringify([connection.workspace?.epoch, place, providers]);
      const first = (provider: string) => JSON.stringify([scope, provider, undefined]);
      return {
        place,
        catalog: new SessionCatalog(
          providers.providers,
          (provider, cursor) => readSessions(connection, place, scope, provider, cursor),
          (provider) => {
            const page = cachedSessions(connection, first(provider), true);
            return page ? { page, stale: !sessionsFresh(connection, first(provider)) } : undefined;
          },
        ),
      };
    });
    // The key holds everything the catalogs read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    for (const { catalog } of catalogs) catalog.start();
    return () => {
      for (const { catalog } of catalogs) catalog.stop();
    };
  }, [catalogs]);
  const store = useMemo(() => combine(catalogs.map(({ catalog }) => catalog)), [catalogs]);
  const snapshots = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return useMemo(() => {
    const sessions: PlacedSession[] = [];
    const errors: DiskSessions["errors"] = [];
    let loading = false;
    let more = false;
    snapshots.forEach((snapshot, index) => {
      const entry = catalogs[index];
      if (!entry) return;
      for (const session of snapshot.sessions) sessions.push({ ...session, place: entry.place });
      for (const provider of snapshot.providers) {
        loading ||= provider.loading;
        more ||= provider.hasMore && !provider.error;
        if (provider.error)
          errors.push({
            key: `${entry.place.directory}:${provider.id}`,
            label: provider.label,
            error: provider.error,
            loading: provider.loading,
            retry: () => entry.catalog.retry(provider.id),
          });
      }
    });
    return {
      sessions,
      loading,
      more,
      errors,
      loadMore: () => {
        for (const { catalog } of catalogs) catalog.loadMore();
      },
    };
  }, [snapshots, catalogs]);
}
