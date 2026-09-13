import { useEffect, useSyncExternalStore } from "react";
import { ApiError } from "@concors/api-client";
import { api } from "@/auth/api";
import { ResourceCache } from "./resource-cache";

let session: string | null | undefined;
const createCache = () =>
  new ResourceCache((error) => error instanceof ApiError && [401, 403].includes(error.status));
let cache = createCache();
/** Credentials and responses never go into persistent storage. A new session gets a fresh cache. */
export function apiCache() {
  const next = api.tokens.get();
  if (session !== next) {
    cache.clear();
    cache = createCache();
    session = next;
  }
  return cache;
}
export function clearApiCache() {
  cache.clear();
  cache = createCache();
}

/** The key must include every request parameter, including the organization. */
export function useApiResource<T>(
  key: string,
  request: () => Promise<T>,
  { enabled = true, staleTime = 30_000 }: { enabled?: boolean; staleTime?: number } = {},
) {
  const resource = apiCache().resource(key, request);
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  useEffect(() => {
    if (enabled) void resource.load(staleTime);
  }, [resource, enabled, staleTime, snapshot.revision]);
  return {
    ...snapshot,
    resource,
    refresh: () => resource.load(staleTime, true),
  };
}
