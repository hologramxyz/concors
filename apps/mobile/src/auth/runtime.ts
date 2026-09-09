import { createApiClient } from "@concors/api-client";
import { config } from "../config";
import { tokenStore } from "../platform/storage";

export const demo = config.demo
  ? import("../demo/server").then(({ createDemoServer }) => createDemoServer())
  : null;
// No Vite proxy or browser cookies are needed by the native app: ApiClient sends a bearer token.
const nativeFetch: typeof fetch = async (input, init) => {
  if (config.developmentDaemon)
    throw new Error("Cloud API calls are disabled in direct-daemon mode.");
  if (demo) return (await demo).fetch(input, init);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15_000);
  try {
    return await fetch(input, { ...init, credentials: "omit", signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
};
export const api = createApiClient({ baseUrl: config.apiUrl, tokenStore, fetch: nativeFetch });
