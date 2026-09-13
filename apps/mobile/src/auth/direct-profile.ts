import { createApiClient, memoryTokenStore } from "@concors/api-client";

/** Profile-only preview session. Never reuse cloud/daemon credentials or send them to the renderer. */
export function createDirectProfileSession(daemon: string, request: typeof fetch = fetch) {
  const url = new URL(daemon);
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/ws"))
    throw new Error("Invalid private profile endpoint");
  if (
    url.protocol !== "wss:" &&
    !(url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error("Profile sign-in requires a secure private connection");
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.slice(0, -3) + "/profile-api";
  const tokens = memoryTokenStore();
  const api = createApiClient({
    baseUrl: url.href,
    tokenStore: tokens,
    fetch: async (input, init) => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 15_000);
      try {
        return await request(input, {
          ...init,
          credentials: "omit",
          redirect: "error",
          signal: abort.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  });
  return {
    api,
    clear: () => tokens.set(null),
    async getProfile() {
      const { user } = await api.getMe();
      // Match desktop's account avatar without exposing this profile-only token to the renderer.
      // Older private gateways may not support the optional GitHub identity route yet.
      const github = await api.githubStatus().catch(() => null);
      return github?.connected && github.login
        ? { ...user, image: `https://github.com/${encodeURIComponent(github.login)}.png?size=96` }
        : user;
    },
  };
}
