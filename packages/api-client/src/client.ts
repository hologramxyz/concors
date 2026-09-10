import type { z } from "zod";

import { ApiError, ApiNetworkError } from "./errors.ts";
import {
  AuthResponseSchema,
  BillingStatusSchema,
  SetupCheckoutSchema,
  SetupConfirmationSchema,
  SubscriptionListSchema,
  type SetupCheckout,
  type MachineSubscription,
  ErrorBodySchema,
  InvoiceListSchema,
  MachineCatalogSchema,
  MachineCostsSchema,
  MachineListSchema,
  MachineResponseSchema,
  MeSchema,
  OrganizationListSchema,
  RedirectSchema,
  SshKeyListSchema,
  SshKeyResponseSchema,
  type ApiUser,
  type BillingStatus,
  type Invoice,
  type Machine,
  type Money,
  type MachineCatalog,
  type MachineCosts,
  type Me,
  type Organization,
  type SshKey,
} from "./schemas.ts";
import { memoryTokenStore, type TokenStore } from "./token-store.ts";
import {
  AccountDeletionSchema,
  MachineConnectionTicketSchema,
  MachineAccessTokenSchema,
  MobileCapabilitiesSchema,
  NO_MOBILE_CAPABILITIES,
  PushDeviceSchema,
  type MobileCapabilities,
  type MachineConnectionTicket,
  type MachineAccessToken,
  type PushDevice,
} from "./mobile.ts";

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

/**
 * Organization a request acts on. Every machine, key and billing call is scoped to one; when
 * omitted the API uses the session's active organization (see `setActiveOrganization`).
 */
export interface OrganizationScope {
  readonly organizationId?: string;
}

export interface CreateMachineInput extends OrganizationScope {
  readonly expectedMonthlyPrice?: Money;
  /** Lowercase letters, digits and hyphens; unique among the organization's live machines. */
  readonly name: string;
  /** Region id from the catalog. */
  readonly region: string;
  /** Size id from the catalog. */
  readonly size: string;
}

export interface AddSshKeyInput extends OrganizationScope {
  readonly name: string;
  /** OpenSSH public key line (`ssh-ed25519 AAAA… comment`). */
  readonly publicKey: string;
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

  // --- machines -------------------------------------------------------------

  /** Regions, sizes (with monthly prices when billing is on) and the OS image of new machines. */
  async getMachineCatalog(): Promise<MachineCatalog> {
    const { data } = await this.#request("GET", "/api/v1/machines/catalog", {
      schema: MachineCatalogSchema,
    });
    return data;
  }

  /** Machines of an organization, newest first; destroyed ones are left out. */
  async listMachines(scope: OrganizationScope = {}): Promise<Machine[]> {
    const { data } = await this.#request("GET", withScope("/api/v1/machines", scope), {
      schema: MachineListSchema,
    });
    return data.machines;
  }

  /**
   * Creates a machine: charges the first month (402 without a card on file or when it is
   * declined), then orders or reuses a VPS. Poll `getMachine` until `status` is `running`.
   */
  async createMachine(input: CreateMachineInput): Promise<Machine> {
    const { data } = await this.#request("POST", "/api/v1/machines", {
      body: input,
      schema: MachineResponseSchema,
    });
    return data.machine;
  }

  /** One machine, refreshed from OVH. 404 for machines of other organizations. */
  async getMachine(id: string): Promise<Machine> {
    const { data } = await this.#request("GET", `/api/v1/machines/${encodeURIComponent(id)}`, {
      schema: MachineResponseSchema,
    });
    return data.machine;
  }

  /**
   * Cancels a machine: nothing is renewed and it keeps running until `paidUntil`, then ends.
   * No refund for the current month. Undo with `resumeMachine` before then.
   */
  async cancelMachine(id: string): Promise<Machine> {
    const { data } = await this.#request("DELETE", `/api/v1/machines/${encodeURIComponent(id)}`, {
      schema: MachineResponseSchema,
    });
    return data.machine;
  }

  /** Undoes `cancelMachine` while the paid month is still running (409 once it ended). */
  async resumeMachine(id: string): Promise<Machine> {
    const { data } = await this.#request(
      "POST",
      `/api/v1/machines/${encodeURIComponent(id)}/resume`,
      { body: {}, schema: MachineResponseSchema },
    );
    return data.machine;
  }

  /** What an organization pays per month for its machines. */
  async getMachineCosts(scope: OrganizationScope = {}): Promise<MachineCosts> {
    const { data } = await this.#request("GET", withScope("/api/v1/machines/costs", scope), {
      schema: MachineCostsSchema,
    });
    return data;
  }

  // --- ssh keys -------------------------------------------------------------

  /** SSH public keys installed on the organization's machines, oldest first. */
  async listSshKeys(scope: OrganizationScope = {}): Promise<SshKey[]> {
    const { data } = await this.#request("GET", withScope("/api/v1/ssh-keys", scope), {
      schema: SshKeyListSchema,
    });
    return data.sshKeys;
  }

  /** Registers a key (422 when it does not parse, 409 when already registered). */
  async addSshKey(input: AddSshKeyInput): Promise<SshKey> {
    const { data } = await this.#request("POST", "/api/v1/ssh-keys", {
      body: input,
      schema: SshKeyResponseSchema,
    });
    return data.sshKey;
  }

  /** Removes a key; machines already installed with it keep it. */
  async removeSshKey(id: string): Promise<void> {
    await this.#request("DELETE", `/api/v1/ssh-keys/${encodeURIComponent(id)}`, {
      schema: null,
    });
  }

  // --- billing --------------------------------------------------------------

  /** Card on file, payment trouble and machine prices for an organization. */
  async getBillingStatus(scope: OrganizationScope = {}): Promise<BillingStatus> {
    const { data } = await this.#request("GET", withScope("/api/v1/billing", scope), {
      schema: BillingStatusSchema,
    });
    return data;
  }

  /**
   * URL of a hosted Stripe Checkout page where the user saves a card for the organization. Open
   * it in the system browser; the API learns about the card through Stripe's webhook.
   */
  async createBillingSetupUrl(scope: OrganizationScope = {}): Promise<string> {
    const { data } = await this.#request("POST", "/api/v1/billing/setup", {
      body: scope,
      schema: RedirectSchema,
    });
    return data.url;
  }

  async createBillingSetup(scope: OrganizationScope = {}): Promise<SetupCheckout> {
    const { data } = await this.#request("POST", "/api/v1/billing/setup", {
      body: scope,
      schema: SetupCheckoutSchema,
    });
    return data;
  }

  async confirmBillingSetup(sessionId: string, scope: OrganizationScope = {}) {
    const { data } = await this.#request("POST", "/api/v1/billing/setup/confirm", {
      body: { ...scope, sessionId },
      schema: SetupConfirmationSchema,
    });
    return data;
  }

  async listMachineSubscriptions(scope: OrganizationScope = {}): Promise<MachineSubscription[]> {
    const { data } = await this.#request("GET", withScope("/api/v1/billing/subscriptions", scope), {
      schema: SubscriptionListSchema,
    });
    return data.subscriptions;
  }

  /** URL of the Stripe customer portal (change card, download invoices). 404 before any card. */
  async createBillingPortalUrl(scope: OrganizationScope = {}): Promise<string> {
    const { data } = await this.#request("POST", "/api/v1/billing/portal", {
      body: scope,
      schema: RedirectSchema,
    });
    return data.url;
  }

  /** Invoices of an organization, newest first. */
  async listInvoices(scope: OrganizationScope = {}): Promise<Invoice[]> {
    const { data } = await this.#request("GET", withScope("/api/v1/billing/invoices", scope), {
      schema: InvoiceListSchema,
    });
    return data.invoices;
  }

  /** Optional mobile contracts. A 404 means this deployment has not implemented them yet. */
  async getMobileCapabilities(): Promise<MobileCapabilities> {
    try {
      const { data } = await this.#request("GET", "/api/v1/mobile/capabilities", {
        schema: MobileCapabilitiesSchema,
      });
      return data;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { ...NO_MOBILE_CAPABILITIES };
      throw error;
    }
  }
  /** @deprecated Unimplemented historical proposal; managed clients use getMachineAccessToken. */
  async connectMachine(machineId: string): Promise<MachineConnectionTicket> {
    const { data } = await this.#request(
      "POST",
      `/api/v1/machines/${encodeURIComponent(machineId)}/connect`,
      {
        body: {},
        schema: MachineConnectionTicketSchema,
      },
    );
    if (data.machineId !== machineId || Date.parse(data.expiresAt) <= Date.now() + 5_000)
      throw new ApiError(
        502,
        "The machine connection ticket is invalid or expired",
        "INVALID_TICKET",
      );
    return data;
  }
  /** The native host owns this credential. Never put it in renderer state, logs or a URL. */
  async getMachineAccessToken(machineId: string): Promise<MachineAccessToken> {
    const { data } = await this.#request(
      "POST",
      `/api/v1/machines/${encodeURIComponent(machineId)}/token`,
      { body: {}, schema: MachineAccessTokenSchema },
    );
    if (data.machineId !== machineId || Date.parse(data.expiresAt) <= Date.now() + 5_000)
      throw new ApiError(
        502,
        "The machine access token is invalid or expired",
        "INVALID_MACHINE_TOKEN",
      );
    return data;
  }
  async registerPushDevice(device: PushDevice): Promise<void> {
    await this.#request("POST", "/api/v1/mobile/devices", {
      body: PushDeviceSchema.parse(device),
      schema: null,
    });
  }
  async unregisterPushDevice(installationId: string): Promise<void> {
    await this.#request("DELETE", `/api/v1/mobile/devices/${encodeURIComponent(installationId)}`, {
      schema: null,
    });
  }
  async deleteAccount(password: string): Promise<"deleted" | "scheduled"> {
    const { data } = await this.#request("POST", "/api/v1/account/deletion", {
      body: { password },
      schema: AccountDeletionSchema,
    });
    return data.status;
  }
  #rememberToken(response: Response, bodyToken: string | null): void {
    const token = response.headers.get(AUTH_TOKEN_HEADER) ?? bodyToken;
    if (token !== null && token !== "") this.tokens.set(token);
  }

  async #request<T>(
    method: "GET" | "POST" | "DELETE",
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

/** Appends `?organizationId=…` when a scope names one. */
function withScope(path: string, scope: OrganizationScope): string {
  if (scope.organizationId === undefined) return path;
  return `${path}?${new URLSearchParams({ organizationId: scope.organizationId }).toString()}`;
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
