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
  type SessionCatalogSnapshot,
  type SessionProvider,
} from "./session-catalog";

/** The folder whose CLI sessions are listed, and the workspace a resumed one opens in. */
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

const EMPTY: SessionCatalogSnapshot = { sessions: [], providers: [] };
const noSubscribe = () => () => undefined;

/**
 * The CLIs' own saved sessions in `place`, from every installed provider, filled in page by page
 * as each provider answers. Sessions seen before show at once and refresh quietly: listing can
 * mean starting a CLI. Null `place` lists nothing.
 */
export function useDiskSessions(
  connection: DaemonConnection | null,
  place: SessionPlace | null,
): { snapshot: SessionCatalogSnapshot; catalog: SessionCatalog | null } {
  const [providers, setProviders] = useState<{
    providers: SessionProvider[];
    revision: number;
  } | null>(() => (connection && knownProviders.get(connection)) || null);
  useEffect(() => {
    if (!connection || !place) return;
    let current = true;
    void listProviders(connection)
      .then((next) => {
        // Unchanged providers keep the list as it is instead of starting it over.
        if (current)
          setProviders((value) => (JSON.stringify(value) === JSON.stringify(next) ? value : next));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [connection, place]);
  const scope =
    connection && place && providers
      ? JSON.stringify([connection.workspace?.epoch, place.projectId, place.directory, providers])
      : null;
  const catalog = useMemo(() => {
    if (!connection || !place || !providers || !scope) return null;
    const key = (provider: string) => JSON.stringify([scope, provider, undefined]);
    return new SessionCatalog(
      providers.providers,
      (provider, cursor) => readSessions(connection, place, scope, provider, cursor),
      (provider) => {
        const page = cachedSessions(connection, key(provider), true);
        return page ? { page, stale: !sessionsFresh(connection, key(provider)) } : undefined;
      },
    );
    // The scope holds everything the catalog reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  useEffect(() => {
    if (!catalog) return;
    catalog.start();
    return catalog.stop;
  }, [catalog]);
  const snapshot = useSyncExternalStore(
    catalog?.subscribe ?? noSubscribe,
    catalog?.getSnapshot ?? (() => EMPTY),
  );
  return { snapshot, catalog };
}
