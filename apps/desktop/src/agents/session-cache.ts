import type { NativeSession, NativeSessionPage } from "@concors/protocol";

/** A page belongs to a connection epoch, workspace directory, provider configuration and query. */
const caches = new WeakMap<object, Map<string, { expires: number; page: NativeSessionPage }>>();
/** A fresh page, or with `stale` any page kept, to show while it is fetched again. */
export function cachedSessions(
  scope: object,
  key: string,
  stale = false,
): NativeSessionPage | undefined {
  const entry = caches.get(scope)?.get(key);
  return entry && (stale || entry.expires > Date.now()) ? entry.page : undefined;
}
export function sessionsFresh(scope: object, key: string): boolean {
  return (caches.get(scope)?.get(key)?.expires ?? 0) > Date.now();
}
export function cacheSessions(scope: object, key: string, page: NativeSessionPage) {
  let cache = caches.get(scope);
  if (!cache) caches.set(scope, (cache = new Map()));
  if (cache.size >= 128) cache.delete(cache.keys().next().value ?? "");
  cache.set(key, { expires: Date.now() + 30_000, page });
}
export function mergeSessions(previous: NativeSession[], page: NativeSession[]) {
  return [...new Map([...previous, ...page].map((session) => [session.id, session])).values()].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
}
