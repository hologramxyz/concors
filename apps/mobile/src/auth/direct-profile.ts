import { ApiError, createApiClient, memoryTokenStore } from "@concors/api-client";
import { z } from "zod";

const ProfileSignInSchema = z.object({ token: z.string().min(1).nullish() });

/**
 * Profile-only preview session. Never reuse cloud/daemon credentials or send them to the renderer.
 *
 * Signing in posts an email and password to the private gateway's `/profile-api`, which forwards it
 * to the account API. That is the legacy password route, kept here only for this preview: the
 * shared API client no longer has it, since the apps sign in through the browser.
 */
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
  const guarded: typeof fetch = async (input, init) => {
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
  };
  const api = createApiClient({ baseUrl: url.href, tokenStore: tokens, fetch: guarded });
  return {
    api,
    clear: () => tokens.set(null),
    async signIn(email: string, password: string) {
      const response = await guarded(`${api.baseUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new ApiError(response.status, "Profile sign-in failed");
      const parsed = ProfileSignInSchema.safeParse(await response.json().catch(() => null));
      const token = response.headers.get("set-auth-token") || parsed.data?.token;
      if (!token) throw new ApiError(response.status, "Profile sign-in failed", "INVALID_RESPONSE");
      tokens.set(token);
    },
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
