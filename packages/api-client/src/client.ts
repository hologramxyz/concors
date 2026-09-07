import type { z } from "zod";

import { ApiError, ApiNetworkError } from "./errors.ts";
import {
  AuthResponseSchema,
  ErrorBodySchema,
  MeSchema,
  OrganizationListSchema,
  type ApiUser,
  type Me,
  type Organization,
} from "./schemas.ts";
import { memoryTokenStore, type TokenStore } from "./token-store.ts";

export interface ApiClientOptions {
  /** Base URL of the control-plane API, e.g. `https://api.concors.dev`. */
  readonly baseUrl: string;
  /** Where the session token is kept between requests. Defaults to memory (lost on reload). */
  readonly tokenStore?: TokenStore;
  /** `fetch` implementation; defaults to the global one. Injected in tests and unusual hosts. */
  readonly fetch?: typeof globalThis.fetch;
}

export interface SignUpInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface SignInInput {
  readonly email: string;
  readonly password: string;
}

/** Response header the API uses to hand out a bearer token alongside the session cookie. */
const AUTH_TOKEN_HEADER = "set-auth-token";

/**
 * Client for the Concors control-plane API.
 *
 * Authentication works two ways at once, so the same code serves every host:
 *
 * - **Bearer token.** Sign-in returns a session token; it is kept in the `TokenStore` and sent as
 *   `Authorization: Bearer …` on every request. This is what native apps (Tauri, React Native) use,
 *   since their webviews are cross-site to the API and cannot rely on cookies.
 * - **Cookies.** Requests are sent with `credentials: "include"`, so when the API is same-site (the
 *   web app, or the desktop dev server proxying `/api`) the HttpOnly session cookie works as well.
 *
 * Every method throws `ApiError` for non-2xx answers and `ApiNetworkError` when the API could not
 * be reached at all. Responses are validated against the schemas in `schemas.ts`.
 */
export class ApiClient {
  readonly baseUrl: string;
  readonly tokens: TokenStore;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.tokens = options.tokenStore ?? memoryTokenStore();
    // Bind to a plain variable: browsers throw "Illegal invocation" when fetch is called with a
    // `this` other than the global object.
    const fetchImpl = options.fetch ?? globalThis.fetch;
    this.#fetch = (input, init) => fetchImpl(input, init);
  }

  /** Creates an account and, unless e-mail verification is required, signs in right away. */
  async signUpWithEmail(input: SignUpInput): Promise<ApiUser> {
    const { data, response } = await this.#request("POST", "/api/auth/sign-up/email", {
      body: input,
      schema: AuthResponseSchema,
    });
    this.#rememberToken(response, data.token);
    return data.user;
  }

  async signInWithEmail(input: SignInInput): Promise<ApiUser> {
    const { data, response } = await this.#request("POST", "/api/auth/sign-in/email", {
      body: input,
      schema: AuthResponseSchema,
    });
    this.#rememberToken(response, data.token);
    return data.user;
  }

  /**
   * Ends the session. The local token is always dropped; revoking the session on the server is
   * best-effort so signing out still works offline or after the session already expired.
   */
  async signOut(): Promise<void> {
    const hadCredentials = this.tokens.get() !== null;
    try {
      await this.#request("POST", "/api/auth/sign-out", { body: {}, schema: null });
    } catch (error) {
      // An expired session answers 401: the goal (no session) is already reached. Anything else
      // only matters if the caller had a token worth revoking.
      if (!(error instanceof ApiError) && hadCredentials) throw error;
    } finally {
      this.tokens.set(null);
    }
  }

  /** Current user and session. Throws `ApiError` with status 401 when there is no valid session. */
  async getMe(): Promise<Me> {
    const { data } = await this.#request("GET", "/api/v1/me", { schema: MeSchema });
    return data;
  }

  /** Organizations the current user belongs to, personal one first. */
  async listOrganizations(): Promise<Organization[]> {
    const { data } = await this.#request("GET", "/api/v1/organizations", {
      schema: OrganizationListSchema,
    });
    return data.organizations;
  }

  /** Switches the organization the session acts within. */
  async setActiveOrganization(organizationId: string): Promise<void> {
    await this.#request("POST", "/api/auth/organization/set-active", {
      body: { organizationId },
      schema: null,
    });
  }

  #rememberToken(response: Response, bodyToken: string | null): void {
    const token = response.headers.get(AUTH_TOKEN_HEADER) ?? bodyToken;
    if (token !== null && token !== "") this.tokens.set(token);
  }

  async #request<T>(
    method: "GET" | "POST",
    path: string,
    options: { readonly body?: unknown; readonly schema: z.ZodType<T> | null },
  ): Promise<{ data: T; response: Response }> {
    const headers = new Headers({ accept: "application/json" });
    const token = this.tokens.get();
    if (token !== null) headers.set("authorization", `Bearer ${token}`);
    const init: RequestInit = { method, headers, credentials: "include" };
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.#fetch(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      throw new ApiNetworkError(this.baseUrl, cause);
    }

    if (!response.ok) throw await describeFailure(response);
    if (options.schema === null) return { data: undefined as T, response };

    const parsed = options.schema.safeParse(await readJson(response));
    if (!parsed.success) {
      throw new ApiError(
        response.status,
        `Unexpected response from ${method} ${path}`,
        "INVALID_RESPONSE",
      );
    }
    return { data: parsed.data, response };
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function describeFailure(response: Response): Promise<ApiError> {
  const parsed = ErrorBodySchema.safeParse(await readJson(response));
  if (parsed.success) return new ApiError(response.status, parsed.data.message, parsed.data.code);
  return new ApiError(response.status, `Request failed with HTTP ${response.status}`);
}
