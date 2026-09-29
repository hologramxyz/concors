import { describe, expect, it, vi } from "vitest";

import {
  ApiClient,
  ApiError,
  ApiNetworkError,
  createApiClient,
  memoryTokenStore,
} from "./index.ts";

const USER = {
  id: "u1",
  name: "Ada",
  email: "ada@example.com",
  emailVerified: false,
  image: null,
  createdAt: "2026-09-07T22:19:04.915Z",
  updatedAt: "2026-09-07T22:19:04.915Z",
};

const ME = {
  user: USER,
  session: { id: "s1", expiresAt: "2026-10-07T22:19:04.927Z", activeOrganizationId: "org1" },
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function client(fetch: typeof globalThis.fetch, token: string | null = null) {
  const tokens = memoryTokenStore(token);
  return {
    api: createApiClient({ baseUrl: "https://api.example/", tokenStore: tokens, fetch }),
    tokens,
  };
}

describe("native sign-in", () => {
  it("builds the start URL for the desktop loopback port", () => {
    const { api } = client(vi.fn());
    const url = new URL(api.nativeSignInUrl({ port: 49152 }, "c".repeat(43)));
    expect(url.origin + url.pathname).toBe("https://api.example/api/v1/native-auth/start");
    expect(url.searchParams.get("port")).toBe("49152");
    expect(url.searchParams.has("app")).toBe(false);
    expect(url.searchParams.get("challenge")).toBe("c".repeat(43));
  });

  it("builds the start URL for the mobile app scheme", () => {
    const { api } = client(vi.fn());
    const url = new URL(api.nativeSignInUrl({ app: "concors" }, "c".repeat(43)));
    expect(url.searchParams.get("app")).toBe("concors");
    expect(url.searchParams.has("port")).toBe(false);
  });

  it("reads the configured sign-in methods", async () => {
    const fetch = vi.fn(async () => json({ github: true, google: true, email: true }));
    await expect(client(fetch).api.getSignInProviders()).resolves.toEqual({
      github: true,
      google: true,
      email: true,
    });
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.example/api/v1/native-auth/providers");
  });

  it("treats methods an older API does not report as unavailable", async () => {
    const fetch = vi.fn(async () => json({ github: true }));
    await expect(client(fetch).api.getSignInProviders()).resolves.toEqual({
      github: true,
      google: false,
      email: false,
    });
  });

  it("redeems the code with the verifier and stores the returned token", async () => {
    const fetch = vi.fn(async () => json({ token: "tok-native" }));
    const { api, tokens } = client(fetch);
    await api.completeNativeSignIn({ code: "k".repeat(43), verifier: "v".repeat(64) });

    expect(tokens.get()).toBe("tok-native");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/api/v1/native-auth/exchange");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      code: "k".repeat(43),
      verifier: "v".repeat(64),
    });
  });

  it("keeps no token when the code is rejected", async () => {
    const fetch = vi.fn(async () =>
      json({ statusCode: 400, error: "Bad Request", message: "Start again." }, { status: 400 }),
    );
    const { api, tokens } = client(fetch);
    await expect(
      api.completeNativeSignIn({ code: "k".repeat(43), verifier: "v".repeat(64) }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(tokens.get()).toBeNull();
  });
});

describe("ApiClient", () => {
  it("strips a trailing slash from the base URL", () => {
    expect(new ApiClient({ baseUrl: "https://api.example///" }).baseUrl).toBe(
      "https://api.example",
    );
  });

  it("sends the stored token as a bearer credential", async () => {
    const fetch = vi.fn(async () => json(ME));
    const { api } = client(fetch, "tok-1");

    await expect(api.getMe()).resolves.toEqual(ME);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
  });

  it("maps error bodies to ApiError", async () => {
    const fastify = vi.fn(async () =>
      json(
        { statusCode: 401, error: "Unauthorized", message: "Authentication required" },
        { status: 401 },
      ),
    );
    await expect(client(fastify).api.getMe()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      unauthorized: true,
      message: "Authentication required",
      code: undefined,
    });

    const coded = vi.fn(async () =>
      json({ message: "Not a member", code: "FORBIDDEN" }, { status: 403 }),
    );
    await expect(client(coded).api.setActiveOrganization("org2")).rejects.toMatchObject({
      status: 403,
      unauthorized: false,
      code: "FORBIDDEN",
    });

    const html = vi.fn(async () => new Response("<h1>Bad Gateway</h1>", { status: 502 }));
    await expect(client(html).api.getMe()).rejects.toMatchObject({
      status: 502,
      message: "Request failed with HTTP 502",
    });
  });

  it("rejects responses that do not match the schema", async () => {
    const fetch = vi.fn(async () => json({ user: { id: 1 } }));
    await expect(client(fetch).api.getMe()).rejects.toMatchObject({
      name: "ApiError",
      code: "INVALID_RESPONSE",
    });
  });

  it("wraps transport failures in ApiNetworkError without touching the token", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { api, tokens } = client(fetch, "tok-1");
    await expect(api.getMe()).rejects.toBeInstanceOf(ApiNetworkError);
    expect(tokens.get()).toBe("tok-1");
  });

  it("signs out locally even when the server rejects the session", async () => {
    const fetch = vi.fn(async () =>
      json({ message: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }),
    );
    const { api, tokens } = client(fetch, "tok-1");
    await expect(api.signOut()).resolves.toBeUndefined();
    expect(tokens.get()).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example/api/auth/sign-out",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reports an unreachable API on sign-out but still drops the token", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const { api, tokens } = client(fetch, "tok-1");
    await expect(api.signOut()).rejects.toBeInstanceOf(ApiNetworkError);
    expect(tokens.get()).toBeNull();
  });

  it("drops the local token immediately while revoking the original session", async () => {
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const fetch = vi.fn(async () => {
      await pending;
      return json({ success: true });
    });
    const { api, tokens } = client(fetch, "old-token");
    const signingOut = api.signOut();
    try {
      expect(tokens.get()).toBeNull();
      const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer old-token");
    } finally {
      finish();
      await signingOut;
    }
  });

  it.each(["success", "expired", "offline"])(
    "keeps a newer sign-in when an older sign-out finishes with %s",
    async (outcome) => {
      let finish: () => void = () => undefined;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const fetch = vi
        .fn()
        .mockImplementationOnce(async () => {
          await pending;
          if (outcome === "offline") throw new TypeError("offline");
          return outcome === "expired"
            ? json({ message: "Unauthorized" }, { status: 401 })
            : json({ success: true });
        })
        .mockResolvedValueOnce(json({ token: "new-token" }));
      const { api, tokens } = client(fetch, "old-token");
      const signingOut = api.signOut().catch((error: unknown) => error);
      await api.completeNativeSignIn({ code: "k".repeat(43), verifier: "v".repeat(64) });
      expect(tokens.get()).toBe("new-token");
      finish();
      await signingOut;
      expect(tokens.get()).toBe("new-token");
    },
  );

  it("lists organizations and switches the active one", async () => {
    const org = {
      id: "org1",
      name: "ada",
      slug: "ada",
      logo: null,
      isPersonal: true,
      role: "owner",
      createdAt: "2026-09-07T22:19:04.915Z",
    };
    const fetch = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/organizations")
        ? json({ organizations: [org] })
        : json({ id: "org1" }),
    );
    const { api } = client(fetch as typeof globalThis.fetch, "tok-1");
    await expect(api.listOrganizations()).resolves.toEqual([org]);
    await expect(api.setActiveOrganization("org1")).resolves.toBeUndefined();
    const [, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ organizationId: "org1" });
  });

  it("is safe to call with an unbound global fetch", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(json(ME));
    } as typeof globalThis.fetch;
    try {
      await expect(new ApiClient({ baseUrl: "https://api.example" }).getMe()).resolves.toEqual(ME);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("throws ApiError instances that survive instanceof checks", () => {
    const error = new ApiError(403, "no", "FORBIDDEN");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
  });
});

describe("account GitHub API", () => {
  it("uses the Concors session for account discovery and VPS preparation without saving GitHub credentials", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({
          configured: true,
          identityConnected: true,
          connected: true,
          login: "alice",
          updatedAt: null,
          manageUrl: "https://github.com/apps/concors/installations/new",
        }),
      )
      .mockResolvedValueOnce(json({ accounts: [{ id: 12, login: "acme" }], nextPage: null }))
      .mockResolvedValueOnce(json({ repositories: [], nextPage: null }))
      .mockResolvedValueOnce(json({ ready: true }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { api, tokens } = client(fetch, "concors-session");
    await expect(api.githubStatus()).resolves.toMatchObject({
      identityConnected: true,
      connected: true,
      login: "alice",
    });
    expect((await api.githubAccounts()).accounts[0]!.login).toBe("acme");
    await api.githubRepositories(12, 2);
    await api.prepareGitHubMachine("machine/1", "acme/private");
    await api.disconnectGitHub();
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example/api/v1/github/",
      "https://api.example/api/v1/github/accounts?page=1",
      "https://api.example/api/v1/github/repositories?installationId=12&page=2",
      "https://api.example/api/v1/github/machines/machine%2F1/prepare",
      "https://api.example/api/v1/github/",
    ]);
    expect(JSON.parse(String(fetch.mock.calls[3]![1]!.body))).toEqual({
      repository: "acme/private",
    });
    expect(
      fetch.mock.calls.every(
        ([, init]) => new Headers(init!.headers).get("authorization") === "Bearer concors-session",
      ),
    ).toBe(true);
    expect(tokens.get()).toBe("concors-session");
  });
});
