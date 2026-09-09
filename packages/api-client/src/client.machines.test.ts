import { describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient, memoryTokenStore } from "./index.ts";

const MACHINE = {
  id: "m1",
  organizationId: "org1",
  createdByUserId: "u1",
  name: "build-agent",
  region: "US-EAST-VA",
  size: "small",
  serviceName: null,
  orderId: "8747150",
  status: "provisioning",
  ovhState: "order:checking",
  lastError: null,
  ipv4: null,
  ipv6: null,
  sshUser: "ubuntu",
  accessReadyAt: null,
  reinstallTaskId: null,
  monthlyPrice: { amount: 6.99, currency: "USD" },
  paidUntil: "2026-10-07T22:06:18.000Z",
  cancelledAt: null,
  createdAt: "2026-09-07T22:06:18.000Z",
  updatedAt: "2026-09-07T22:06:18.000Z",
  deletedAt: null,
};

const SSH_KEY = {
  id: "k1",
  organizationId: "org1",
  createdByUserId: "u1",
  name: "laptop",
  type: "ssh-ed25519",
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL60pUhqXVxr71FUwtXz57l99pPdV3w66hCfM1zHB83P",
  fingerprint: "SHA256:Vu3fKTRgaJ7bVZQ+/QqBhWLIwjiYb2gDH+Mn8KopSFM",
  createdAt: "2026-09-07T20:30:05.810Z",
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function client(fetch: typeof globalThis.fetch) {
  return createApiClient({
    baseUrl: "https://api.example",
    tokenStore: memoryTokenStore("tok-1"),
    fetch,
  });
}

function lastCall(fetch: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const [url, init] = fetch.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url, init };
}

describe("ApiClient machines", () => {
  it("preserves upstream agent and TLS readiness while supporting older deployments", async () => {
    const machine = {
      ...MACHINE,
      hostname: "machine.example",
      agentInstalledAt: "2026-09-09T00:00:00.000Z",
      agentSeenAt: "2026-09-09T00:01:00.000Z",
      agentVersion: "0.1.0",
      agentError: null,
      certificateExpiresAt: "2026-12-09T00:00:00.000Z",
      certificateError: null,
    };
    await expect(client(async () => json({ machine })).getMachine("m1")).resolves.toEqual(machine);
    await expect(client(async () => json({ machine: MACHINE })).getMachine("m1")).resolves.toEqual(
      MACHINE,
    );
  });
  it("reads the catalog", async () => {
    const catalog = {
      regions: [{ id: "US-EAST-VA", location: "Vint Hill, Virginia", countryCode: "US" }],
      sizes: [
        {
          id: "small",
          vcpus: 2,
          ramGb: 4,
          diskGb: 40,
          monthlyPrice: { amount: 6.99, currency: "USD" },
        },
        { id: "medium", vcpus: 4, ramGb: 8, diskGb: 75, monthlyPrice: null },
      ],
      image: "Ubuntu 24.04",
      sshUser: "ubuntu",
    };
    const fetch = vi.fn(async () => json(catalog));

    await expect(client(fetch).getMachineCatalog()).resolves.toEqual(catalog);
    expect(lastCall(fetch).url).toBe("https://api.example/api/v1/machines/catalog");
  });

  it("lists machines, scoped to an organization when asked", async () => {
    const fetch = vi.fn(async () => json({ machines: [MACHINE] }));
    const api = client(fetch);

    await expect(api.listMachines()).resolves.toEqual([MACHINE]);
    expect(lastCall(fetch).url).toBe("https://api.example/api/v1/machines");

    await api.listMachines({ organizationId: "org 2" });
    expect(lastCall(fetch).url).toBe("https://api.example/api/v1/machines?organizationId=org+2");
    expect(new Headers(lastCall(fetch).init.headers).get("authorization")).toBe("Bearer tok-1");
  });

  it("creates, reads, cancels and resumes a machine", async () => {
    const fetch = vi.fn(async () => json({ machine: MACHINE }));
    const api = client(fetch);

    await expect(
      api.createMachine({ name: "build-agent", region: "US-EAST-VA", size: "small" }),
    ).resolves.toEqual(MACHINE);
    let call = lastCall(fetch);
    expect(call.url).toBe("https://api.example/api/v1/machines");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(call.init.body as string)).toEqual({
      name: "build-agent",
      region: "US-EAST-VA",
      size: "small",
    });

    await expect(api.getMachine("m 1")).resolves.toEqual(MACHINE);
    expect(lastCall(fetch).url).toBe("https://api.example/api/v1/machines/m%201");

    await expect(api.cancelMachine("m1")).resolves.toEqual(MACHINE);
    call = lastCall(fetch);
    expect(call.url).toBe("https://api.example/api/v1/machines/m1");
    expect(call.init.method).toBe("DELETE");

    await expect(api.resumeMachine("m1")).resolves.toEqual(MACHINE);
    call = lastCall(fetch);
    expect(call.url).toBe("https://api.example/api/v1/machines/m1/resume");
    expect(call.init.method).toBe("POST");
  });

  it("surfaces a payment failure as ApiError 402", async () => {
    const fetch = vi.fn(async () =>
      json(
        { statusCode: 402, error: "Payment Required", message: "Payment failed: card declined" },
        { status: 402 },
      ),
    );

    await expect(
      client(fetch).createMachine({ name: "x", region: "US-EAST-VA", size: "small" }),
    ).rejects.toMatchObject({ name: "ApiError", status: 402, message: /declined/ });
  });

  it("rejects a response that no longer matches the schema", async () => {
    const fetch = vi.fn(async () => json({ machine: { ...MACHINE, status: "exploded" } }));

    await expect(client(fetch).getMachine("m1")).rejects.toMatchObject({
      name: "ApiError",
      code: "INVALID_RESPONSE",
    });
    await expect(client(fetch).getMachine("m1")).rejects.toBeInstanceOf(ApiError);
  });

  it("reads costs", async () => {
    const costs = {
      machines: [
        {
          id: "m1",
          name: "build-agent",
          region: "US-EAST-VA",
          size: "small",
          status: "running",
          monthlyPrice: { amount: 6.99, currency: "USD" },
          createdAt: MACHINE.createdAt,
        },
      ],
      monthlyTotal: { amount: 6.99, currency: "USD" },
      unpricedMachines: 0,
    };
    const fetch = vi.fn(async () => json(costs));

    await expect(client(fetch).getMachineCosts({ organizationId: "org1" })).resolves.toEqual(costs);
    expect(lastCall(fetch).url).toBe(
      "https://api.example/api/v1/machines/costs?organizationId=org1",
    );
  });
});

describe("ApiClient ssh keys", () => {
  it("lists, adds and removes keys", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : init?.method === "POST"
          ? json({ sshKey: SSH_KEY }, { status: 201 })
          : json({ sshKeys: [SSH_KEY] }),
    );
    const api = client(fetch as unknown as typeof globalThis.fetch);

    await expect(api.listSshKeys()).resolves.toEqual([SSH_KEY]);
    await expect(
      api.addSshKey({ name: "laptop", publicKey: `${SSH_KEY.publicKey} me@laptop` }),
    ).resolves.toEqual(SSH_KEY);
    expect(JSON.parse(lastCall(fetch).init.body as string)).toEqual({
      name: "laptop",
      publicKey: `${SSH_KEY.publicKey} me@laptop`,
    });

    await expect(api.removeSshKey("k1")).resolves.toBeUndefined();
    expect(lastCall(fetch).url).toBe("https://api.example/api/v1/ssh-keys/k1");
    expect(lastCall(fetch).init.method).toBe("DELETE");
  });
});

describe("ApiClient billing", () => {
  it("reads the billing status", async () => {
    const status = {
      configured: true,
      hasPaymentMethod: true,
      card: { brand: "visa", last4: "4242", expMonth: 9, expYear: 2027 },
      paymentFailedAt: null,
      prices: [{ size: "small", monthlyPrice: { amount: 6.99, currency: "USD" } }],
    };
    const fetch = vi.fn(async () => json(status));

    await expect(client(fetch).getBillingStatus()).resolves.toEqual(status);
    expect(lastCall(fetch).url).toBe("https://api.example/api/v1/billing");
  });

  it("hands out the Checkout and portal URLs", async () => {
    const fetch = vi.fn(async () => json({ url: "https://checkout.stripe.test/s" }));
    const api = client(fetch);

    await expect(api.createBillingSetupUrl({ organizationId: "org1" })).resolves.toBe(
      "https://checkout.stripe.test/s",
    );
    let call = lastCall(fetch);
    expect(call.url).toBe("https://api.example/api/v1/billing/setup");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(call.init.body as string)).toEqual({ organizationId: "org1" });

    await api.createBillingPortalUrl();
    call = lastCall(fetch);
    expect(call.url).toBe("https://api.example/api/v1/billing/portal");
    expect(JSON.parse(call.init.body as string)).toEqual({});
  });

  it("lists invoices", async () => {
    const invoice = {
      id: "in_1",
      number: "0001",
      status: "paid",
      amountDue: { amount: 6.99, currency: "USD" },
      amountPaid: { amount: 6.99, currency: "USD" },
      createdAt: "2026-09-07T22:06:18.000Z",
      periodStart: "2026-09-07T22:06:18.000Z",
      periodEnd: "2026-10-07T22:06:18.000Z",
      hostedInvoiceUrl: "https://invoice.stripe.test/i",
      invoicePdf: null,
    };
    const fetch = vi.fn(async () => json({ invoices: [invoice] }));

    await expect(client(fetch).listInvoices()).resolves.toEqual([invoice]);
    expect(lastCall(fetch).url).toBe("https://api.example/api/v1/billing/invoices");
  });
});
