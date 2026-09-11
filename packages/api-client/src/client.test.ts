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

describe("ApiClient", () => {
  it("strips a trailing slash from the base URL", () => {
    expect(new ApiClient({ baseUrl: "https://api.example///" }).baseUrl).toBe(
      "https://api.example",
    );
  });

  it("signs in, stores the token from the body and returns the user", async () => {
    const fetch = vi.fn(async () => json({ redirect: false, token: "tok-1", user: USER }));
    const { api, tokens } = client(fetch);

    await expect(
      api.signInWithEmail({ email: USER.email, password: "secret-123" }),
    ).resolves.toEqual(USER);
    expect(tokens.get()).toBe("tok-1");

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/api/auth/sign-in/email");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ email: USER.email, password: "secret-123" });
  });

  it("prefers the set-auth-token header over the body token", async () => {
    const fetch = vi.fn(async () =>
      json({ token: "body-token", user: USER }, { headers: { "set-auth-token": "signed.token" } }),
    );
    const { api, tokens } = client(fetch);
    await api.signUpWithEmail({ name: "Ada", email: USER.email, password: "secret-123" });
    expect(tokens.get()).toBe("signed.token");
  });

  it("leaves the store untouched when sign-up did not open a session", async () => {
    const fetch = vi.fn(async () => json({ token: null, user: USER }));
    const { api, tokens } = client(fetch);
    await api.signUpWithEmail({ name: "Ada", email: USER.email, password: "secret-123" });
    expect(tokens.get()).toBeNull();
  });

  it("sends the stored token as a bearer credential", async () => {
    const fetch = vi.fn(async () => json(ME));
    const { api } = client(fetch, "tok-1");

    await expect(api.getMe()).resolves.toEqual(ME);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
  });

  it("maps Fastify and Better Auth error bodies to ApiError", async () => {
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

    const betterAuth = vi.fn(async () =>
      json(
        { message: "Invalid email or password", code: "INVALID_EMAIL_OR_PASSWORD" },
        { status: 401 },
      ),
    );
    await expect(
      client(betterAuth).api.signInWithEmail({ email: USER.email, password: "nope" }),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" });

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
        .mockResolvedValueOnce(json({ token: "new-token", user: USER }));
      const { api, tokens } = client(fetch, "old-token");
      const signingOut = api.signOut().catch((error: unknown) => error);
      await api.signInWithEmail({ email: USER.email, password: "secret-123" });
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
