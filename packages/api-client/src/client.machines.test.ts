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
  it("retains the managed daemon fields returned by the control plane", async () => {
    const managed = {
      ...MACHINE,
      hostname: "m-example.dev.concors.app",
      agentSeenAt: "2026-09-10T00:00:00Z",
      agentVersion: "0.2.0",
      agentInstalledAt: "2026-09-09T00:00:00Z",
      agentError: null,
      certificateExpiresAt: "2026-12-09T00:00:00Z",
    };
    const fetch = vi.fn(async () => json({ machines: [managed] }));
    await expect(client(fetch).listMachines()).resolves.toEqual([managed]);
  });
  it("mints a machine token with session authorization and validates the response", async () => {
    const fetch = vi.fn(async () => json({ token: "machine-jwt" }, { status: 201 }));
    await expect(client(fetch).mintMachineToken("machine/1")).resolves.toEqual({
      token: "machine-jwt",
    });
    const { url, init } = lastCall(fetch);
    expect(url).toBe("https://api.example/api/v1/machines/machine%2F1/token");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
    fetch.mockResolvedValueOnce(json({ token: "" }));
    await expect(client(fetch).mintMachineToken("machine/1")).rejects.toThrow();
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
          soldOutRegions: ["US-EAST-VA"],
        },
        // Servers that predate stock reporting omit `soldOutRegions`.
        { id: "medium", vcpus: 4, ramGb: 8, diskGb: 75, monthlyPrice: null },
      ],
      image: "Ubuntu 24.04",
      sshUser: "ubuntu",
    };
    const fetch = vi.fn(async () => json(catalog));

    const read = await client(fetch).getMachineCatalog();
    expect(read.sizes.map((size) => size.soldOutRegions)).toEqual([["US-EAST-VA"], []]);
    expect(read).toMatchObject(catalog);
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

  it("adds the person's own server and renews its setup command", async () => {
    const external = { ...MACHINE, provider: "external", region: "external", size: "external" };
    const command = "curl -fsSL https://api.example/api/v1/connect/tok | sudo bash";
    const fetch = vi.fn(() => Promise.resolve(json({ machine: external, command })));
    const api = client(fetch);

    await expect(
      api.createExternalMachine({ name: "home-box", organizationId: "org1" }),
    ).resolves.toEqual({ machine: external, command });
    let call = lastCall(fetch);
    expect(call.url).toBe("https://api.example/api/v1/machines/external");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(call.init.body as string)).toEqual({
      name: "home-box",
      organizationId: "org1",
    });

    await expect(api.renewConnectCommand("m1")).resolves.toEqual({ machine: external, command });
    call = lastCall(fetch);
    expect(call.url).toBe("https://api.example/api/v1/machines/m1/connect-command");
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

describe("ApiClient provider subscriptions", () => {
  const SUBSCRIPTION = {
    id: "claude-work-1a2b3c4d",
    engine: "claude",
    nickname: "Work",
    accountNickname: null,
    accountLabel: "me@example.com",
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  } as const;

  it("lists, saves, imports and removes accounts", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : init?.method === "PUT"
          ? json({ subscription: SUBSCRIPTION })
          : json({ subscriptions: [SUBSCRIPTION] }),
    );
    const api = client(fetch as unknown as typeof globalThis.fetch);

    await expect(api.listProviderSubscriptions()).resolves.toEqual([SUBSCRIPTION]);
    expect(lastCall(fetch).url).toBe("https://api.example/api/v1/subscriptions");

    await expect(
      api.saveProviderSubscription(SUBSCRIPTION.id, {
        engine: "claude",
        nickname: "Work",
        accountLabel: "me@example.com",
      }),
    ).resolves.toEqual(SUBSCRIPTION);
    expect(lastCall(fetch).url).toBe(
      "https://api.example/api/v1/subscriptions/claude-work-1a2b3c4d",
    );
    expect(lastCall(fetch).init.method).toBe("PUT");

    await expect(
      api.importProviderSubscriptions([
        { id: SUBSCRIPTION.id, engine: "claude", nickname: "Work" },
      ]),
    ).resolves.toEqual([SUBSCRIPTION]);
    expect(JSON.parse(lastCall(fetch).init.body as string)).toEqual({
      subscriptions: [{ id: SUBSCRIPTION.id, engine: "claude", nickname: "Work" }],
    });

    await expect(api.removeProviderSubscription(SUBSCRIPTION.id)).resolves.toBeUndefined();
    expect(lastCall(fetch).init.method).toBe("DELETE");
  });
});

describe("ApiClient billing", () => {
  it("reads the billing status", async () => {
    const status = {
      configured: true,
      testMode: true,
      hasPaymentMethod: true,
      card: { brand: "visa", last4: "4242", expMonth: 9, expYear: 2027 },
      paymentFailedAt: null,
      prices: [{ size: "small", monthlyPrice: { amount: 6.99, currency: "USD" } }],
    };
    const fetch = vi.fn(async () => json(status));

    // Servers from before waivers charge everyone.
    await expect(client(fetch).getBillingStatus()).resolves.toEqual({ ...status, waived: false });
    expect(lastCall(fetch).url).toBe("https://api.example/api/v1/billing");
  });

  it("reads an organization whose machines are not charged", async () => {
    const status = {
      configured: true,
      waived: true,
      testMode: false,
      hasPaymentMethod: false,
      card: null,
      paymentFailedAt: null,
      prices: [{ size: "small", monthlyPrice: { amount: 19, currency: "USD" } }],
    };
    const fetch = vi.fn(async () => json(status));

    await expect(client(fetch).getBillingStatus()).resolves.toEqual(status);
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

describe("verified billing checkout and subscriptions", () => {
  it("keeps checkout confirmation explicitly scoped to the organization", async () => {
    const fetch = vi.fn(async () =>
      json({ sessionId: "cs_test_1", url: "https://checkout.stripe.test/s" }),
    );
    const api = client(fetch);
    await expect(api.createBillingSetup({ organizationId: "org1" })).resolves.toEqual({
      sessionId: "cs_test_1",
      url: "https://checkout.stripe.test/s",
    });
    expect(JSON.parse(String(lastCall(fetch).init.body))).toEqual({ organizationId: "org1" });
    fetch.mockResolvedValue(json({ status: "complete" }));
    await expect(api.confirmBillingSetup("cs_test_1", { organizationId: "org1" })).resolves.toEqual(
      { status: "complete" },
    );
    expect(lastCall(fetch).url).toBe("https://api.example/api/v1/billing/setup/confirm");
    expect(JSON.parse(String(lastCall(fetch).init.body))).toEqual({
      sessionId: "cs_test_1",
      organizationId: "org1",
    });
  });
  it("validates subscriptions and sends the organization scope", async () => {
    const subscription = {
      id: "sub_1",
      machineId: "m1",
      machineName: "build-agent",
      region: "US-EAST-VA",
      size: "small",
      status: "active",
      monthlyPrice: MACHINE.monthlyPrice,
      currentPeriodEnd: MACHINE.paidUntil,
      cancelAtPeriodEnd: false,
    };
    const fetch = vi.fn(async () => json({ subscriptions: [subscription] }));
    await expect(
      client(fetch).listMachineSubscriptions({ organizationId: "org 2" }),
    ).resolves.toEqual([subscription]);
    expect(lastCall(fetch).url).toBe(
      "https://api.example/api/v1/billing/subscriptions?organizationId=org+2",
    );
  });
});

it("preserves partial resource usage from machine lists and supports old servers", async () => {
  const resourceUsage = {
    memory: { totalBytes: 8192, availableBytes: 4096 },
    disk: null,
    sampledAt: "2026-09-11T12:00:00.000Z",
  };
  const fetch = vi.fn(async () => json({ machines: [{ ...MACHINE, resourceUsage }, MACHINE] }));
  const machines = await client(fetch).listMachines();
  expect(machines[0]?.resourceUsage).toEqual(resourceUsage);
  expect(machines[1]?.resourceUsage).toBeUndefined();
});

it("retries tool setup with authorization and preserves returned setup state", async () => {
  const developmentToolsSetup = {
    status: "pending",
    updatedAt: "2026-09-11T12:00:00.000Z",
    error: null,
    versions: {},
  };
  const machine = {
    ...MACHINE,
    developmentTools: { node: "lts", docker: true },
    developmentToolsSetup,
  };
  const fetch = vi.fn(async () => json({ machine }));
  await expect(client(fetch).retryDevelopmentTools("machine/1")).resolves.toEqual(machine);
  const { url, init } = lastCall(fetch);
  expect(url).toBe("https://api.example/api/v1/machines/machine%2F1/development-tools/retry");
  expect(init.method).toBe("POST");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
  fetch.mockResolvedValueOnce(json({ message: "Already running" }, { status: 409 }));
  await expect(client(fetch).retryDevelopmentTools("machine/1")).rejects.toMatchObject({
    status: 409,
  });
});

it("renames a machine with authorization and exposes name conflicts", async () => {
  const renamed = { ...MACHINE, name: "production" };
  const fetch = vi.fn(async () => json({ machine: renamed }));
  const api = client(fetch);
  await expect(api.renameMachine("machine/1", "production")).resolves.toEqual(renamed);
  const { url, init } = lastCall(fetch);
  expect(url).toBe("https://api.example/api/v1/machines/machine%2F1");
  expect(init.method).toBe("PATCH");
  expect(JSON.parse(String(init.body))).toEqual({ name: "production" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
  fetch.mockResolvedValueOnce(json({ message: "Name already exists" }, { status: 409 }));
  await expect(api.renameMachine("machine/1", "production")).rejects.toMatchObject({
    status: 409,
    message: "Name already exists",
  });
});

it("saves or resets a machine icon with authorization", async () => {
  const machine = { ...MACHINE, icon: "🚀" };
  const fetch = vi.fn(async () => json({ machine }));
  const api = client(fetch);
  await expect(api.updateMachineIcon("machine/1", "🚀")).resolves.toEqual(machine);
  const { url, init } = lastCall(fetch);
  expect(url).toBe("https://api.example/api/v1/machines/machine%2F1/icon");
  expect(init.method).toBe("PATCH");
  expect(JSON.parse(String(init.body))).toEqual({ icon: "🚀" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
  fetch.mockResolvedValueOnce(json({ machine: { ...machine, icon: null } }));
  await expect(api.updateMachineIcon("machine/1", null)).resolves.toMatchObject({ icon: null });
  await expect(api.updateMachineIcon("machine/1", "not an emoji")).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("reads a pending daemon update and tolerates servers without one", async () => {
  for (const daemonUpdate of [
    { version: "0.7.0", installing: false },
    { version: "0.7.0", installing: true },
    null,
  ]) {
    const machine = { ...MACHINE, daemonUpdate };
    await expect(client(async () => json({ machines: [machine] })).listMachines()).resolves.toEqual(
      [machine],
    );
  }
  await expect(client(async () => json({ machine: MACHINE })).getMachine("m1")).resolves.toEqual(
    MACHINE,
  );
  await expect(
    client(async () =>
      json({ machine: { ...MACHINE, daemonUpdate: { version: "0.7.0" } } }),
    ).getMachine("m1"),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

it("asks for a daemon update with authorization and exposes why it was refused", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 202 }));
  const api = client(fetch);
  await expect(api.updateMachineDaemon("machine/1")).resolves.toBeUndefined();
  const { url, init } = lastCall(fetch);
  expect(url).toBe("https://api.example/api/v1/machines/machine%2F1/daemon/update");
  expect(init.method).toBe("POST");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
  fetch.mockResolvedValueOnce(
    json({ message: "This machine's daemon is already up to date" }, { status: 409 }),
  );
  await expect(api.updateMachineDaemon("machine/1")).rejects.toMatchObject({
    name: "ApiError",
    status: 409,
    message: "This machine's daemon is already up to date",
  });
});
