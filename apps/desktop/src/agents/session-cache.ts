import type { NativeSession, NativeSessionPage, ProviderStatus } from "@concors/protocol";
import type { SessionProvider } from "./session-catalog";

/** The machine's session providers from the last visit, so reopening lists sessions at once. */
export const knownProviders = new WeakMap<
  object,
  { providers: SessionProvider[]; revision: number }
>();
/** Keeps a provider list read elsewhere, so the session check needs no request of its own. */
export function rememberProviders(scope: object, providers: ProviderStatus[], revision: number) {
  // Subscriptions share their engine's conversations, which the base provider already
  // lists; sessions are grouped by harness, never by account.
  const known = {
    providers: providers
      .filter((p) => p.enabled && p.installed && !p.subscription)
      .map((p) => ({ id: p.id, label: p.label })),
    revision,
  };
  knownProviders.set(scope, known);
  return known;
}

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
