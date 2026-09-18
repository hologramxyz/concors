import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";

const price = { amount: 6.99, currency: "USD" };
const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL60pUhqXVxr71FUwtXz57l99pPdV3w66hCfM1zHB83P";
const machine = {
  id: "vps-1",
  organizationId: "e2e-org",
  createdByUserId: "e2e-user",
  name: "build-agent",
  region: "US-EAST-VA",
  size: "small",
  serviceName: null,
  orderId: "order-1",
  status: "provisioning",
  ovhState: "order:delivering",
  lastError: null,
  ipv4: null,
  ipv6: null,
  sshUser: "ubuntu",
  accessReadyAt: null,
  reinstallTaskId: null,
  monthlyPrice: price,
  paidUntil: "2026-10-08T00:00:00.000Z",
  cancelledAt: null,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  deletedAt: null,
};

async function billingApi(
  page: Page,
  options: {
    card?: boolean;
    unpriced?: boolean;
    decline?: boolean;
    savedKey?: boolean;
    /** An existing machine that accepts SSH logins. */
    ready?: boolean;
    /** ISO date of the last failed charge, as the server reports it. */
    paymentFailed?: string;
  } = {},
) {
  await signedIn(page);
  const state = {
    card: options.card ?? false,
    complete: false,
    created: false,
    keyAdded: options.savedKey ?? false,
    requests: [] as { path: string; body: unknown }[],
  };
  await page.route("**/api/v1/{machines,billing,ssh-keys}**", async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": request.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const url = new URL(request.url());
    const path = url.pathname;
    const body: unknown = request.method() === "POST" ? request.postDataJSON() : undefined;
    state.requests.push({ path, body });
    if (request.method() === "GET" && !path.endsWith("/catalog"))
      expect(url.searchParams.get("organizationId")).toBe("e2e-org");
    if (request.method() === "POST") expect(body).toMatchObject({ organizationId: "e2e-org" });
    let result: unknown;
    let status = 200;
    if (path.endsWith("/machines/catalog"))
      result = {
        developmentTools: {
          nodeVersions: ["lts", "24", "22"],
          additionalTools: ["python", "go", "rust"],
        },
        regions: [
          { id: "US-EAST-VA", location: "Vint Hill, Virginia", countryCode: "US" },
          { id: "US-WEST-OR", location: "Hillsboro, Oregon", countryCode: "US" },
        ],
        sizes: [
          {
            id: "small",
            vcpus: 2,
            ramGb: 4,
            diskGb: 40,
            monthlyPrice: options.unpriced ? null : price,
          },
          {
            id: "medium",
            vcpus: 4,
            ramGb: 8,
            diskGb: 75,
            monthlyPrice: options.unpriced ? null : { amount: 12.99, currency: "USD" },
          },
          {
            id: "large",
            vcpus: 6,
            ramGb: 12,
            diskGb: 100,
            monthlyPrice: options.unpriced ? null : { amount: 18.99, currency: "USD" },
          },
          {
            id: "xlarge",
            vcpus: 8,
            ramGb: 24,
            diskGb: 200,
            monthlyPrice: options.unpriced ? null : { amount: 35.99, currency: "USD" },
          },
        ],
        image: "Ubuntu 24.04",
        sshUser: "ubuntu",
      };
    else if (path.endsWith("/billing/setup/confirm")) {
      if (state.complete) state.card = true;
      result = { status: state.complete ? "complete" : "open" };
    } else if (path.endsWith("/billing/setup"))
      result = { url: "https://checkout.stripe.test/setup", sessionId: "cs_test_1" };
    else if (path.endsWith("/billing/portal"))
      result = { url: "https://checkout.stripe.test/portal" };
    else if (path.endsWith("/billing/invoices")) result = { invoices: [] };
    else if (path.endsWith("/billing/subscriptions"))
      result = {
        subscriptions: state.created
          ? [
              {
                id: "sub_1",
                machineId: machine.id,
                machineName: machine.name,
                region: machine.region,
                size: machine.size,
                status: "active",
                monthlyPrice: price,
                currentPeriodEnd: machine.paidUntil,
                cancelAtPeriodEnd: false,
              },
            ]
          : [],
      };
    else if (path.endsWith("/billing"))
      result = {
        configured: true,
        testMode: true,
        hasPaymentMethod: state.card,
        card: state.card ? { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 } : null,
        paymentFailedAt: options.paymentFailed ?? null,
        prices: options.unpriced
          ? []
          : [
              { size: "small", monthlyPrice: price },
              { size: "medium", monthlyPrice: { amount: 12.99, currency: "USD" } },
              { size: "large", monthlyPrice: { amount: 18.99, currency: "USD" } },
              { size: "xlarge", monthlyPrice: { amount: 35.99, currency: "USD" } },
            ],
      };
    else if (path.endsWith("/ssh-keys")) {
      const sshKey = {
        id: "key-1",
        organizationId: "e2e-org",
        createdByUserId: "e2e-user",
        name: "build-agent access",
        type: "ssh-ed25519",
        publicKey: key,
        fingerprint: "SHA256:test",
        createdAt: machine.createdAt,
      };
      if (request.method() === "POST") {
        state.keyAdded = true;
        result = { sshKey };
      } else result = { sshKeys: state.keyAdded ? [sshKey] : [] };
    } else if (path.endsWith("/machines")) {
      if (request.method() === "POST") {
        expect(state.card).toBe(true);
        expect(body).toMatchObject({
          name: "build-agent",
          region: machine.region,
          size: "small",
          expectedMonthlyPrice: price,
        });
        if (options.decline) {
          status = 402;
          result = { message: "Your card was declined" };
        } else {
          state.created = true;
          status = 201;
          result = { machine };
        }
      } else
        result = {
          machines: options.ready ? [readyMachine] : state.created ? [machine] : [],
        };
    } else throw new Error(`Unexpected billing API: ${path}`);
    await route.fulfill({
      status,
      headers,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  // Exercise opening the hosted page without contacting Stripe or submitting a real order.
  await page
    .context()
    .route("https://checkout.stripe.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "Stripe card setup" }),
    );
  return state;
}

const readyMachine = {
  ...machine,
  status: "running",
  ovhState: "running",
  serviceName: "vps-1.vps.ovh.us",
  ipv4: "147.135.1.2",
  accessReadyAt: "2026-09-08T00:10:00.000Z",
};

async function openMachines(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage machines", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Machines", exact: true }).first()).toBeVisible();
}

async function openCreation(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage machines", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Machines", exact: true }).first()).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Machines", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "New machine", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "New VPS" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("build-agent");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

test("create a workspace VPS with a test card, then view its subscription in Profile", async ({
  page,
}) => {
  const state = await billingApi(page);
  await openCreation(page);
  const pay = page.getByRole("button", { name: "Pay $6.99 & deploy", exact: true });
  await expect(pay).toBeDisabled();
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Add a card with Stripe" }).click();
  const checkout = await popup;
  await expect(
    page.getByText("Complete card setup in your browser", { exact: false }),
  ).toBeVisible();
  expect(state.created).toBe(false);
  state.complete = true;
  await checkout.close();
  await expect(pay).toBeEnabled({ timeout: 10_000 });
  expect(state.created).toBe(false);
  await pay.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "build-agent" })).toBeVisible();
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /build-agent provisioning/i })).toBeVisible();
  await page.getByRole("menuitem", { name: /build-agent provisioning/i }).click();
  await expect(page.locator("#cloud-machine-vps-1")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "Account", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "VPS subscriptions" })).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("$6.99/month", { exact: true })).toBeVisible();
  await expect(page.getByText("Stripe test mode", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Renews/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Cancel build-agent|Delete/ })).toHaveCount(0);
});

test("a declined payment keeps the form and does not create a VPS", async ({ page }) => {
  const state = await billingApi(page, { card: true, decline: true });
  await openCreation(page);
  await page.getByRole("button", { name: "Pay $6.99 & deploy", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your card was declined");
  await expect(page.getByRole("dialog", { name: "New VPS" })).toBeVisible();
  expect(state.created).toBe(false);
});

test("missing Stripe prices cannot be mistaken for a free VPS", async ({ page }) => {
  const state = await billingApi(page, { card: true, unpriced: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage machines", exact: true }).click();
  await page.getByRole("button", { name: "New machine", exact: true }).first().click();
  await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await expect(page.getByText("Free", { exact: true })).toHaveCount(0);
  expect(state.created).toBe(false);
});

test("Stripe returns work in a browser without a desktop session", async ({ page }) => {
  await page.goto("/settings/billing?setup=success");
  await expect(page.getByRole("heading", { name: "Card setup submitted" })).toBeVisible();
  await expect(
    page.getByText("Return to your original Concors window", { exact: false }),
  ).toBeVisible();
  await page.goto("/settings/billing?setup=cancelled");
  await expect(page.getByRole("heading", { name: "Card setup cancelled" })).toBeVisible();
});

test("returning from card setup can be abandoned without paying or losing the VPS form", async ({
  page,
}) => {
  const state = await billingApi(page);
  await openCreation(page);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Add a card with Stripe" }).click();
  const checkout = await popup;
  await checkout.close();
  await page.getByRole("button", { name: "Back to payment", exact: true }).click();
  await expect(page.getByText("build-agent", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a card with Stripe" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Pay $6.99 & deploy", exact: true }),
  ).toBeDisabled();
  expect(state.created).toBe(false);
});

test("machine views reuse fresh data and explicit refresh updates the switcher", async ({
  page,
}) => {
  const state = await billingApi(page);
  state.created = true;
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /build-agent provisioning/i })).toBeVisible();
  // The local daemon may or may not have finished connecting when the menu opens.
  await expect(
    page.getByRole("menuitem", { name: /^This computer (Selected|Connected)$/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const reads = () =>
    state.requests.filter((request) => request.path.endsWith("/machines") && !request.body).length;
  const before = reads();
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /build-agent provisioning/i })).toBeVisible();
  expect(reads()).toBe(before);
  await page.getByRole("menuitem", { name: /build-agent provisioning/i }).click();
  await expect(page.getByRole("heading", { name: "build-agent", exact: true })).toBeVisible();
  expect(reads()).toBe(before);
  state.created = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No cloud machines yet" })).toBeVisible();
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /build-agent provisioning/i })).toHaveCount(0);
  expect(reads()).toBe(before + 1);
});

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 700 },
]) {
  test(`VPS modal fits a ${viewport.width}px window and keeps its footer visible`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "dark" });
    await billingApi(page, { card: true });
    await openCreation(page);
    const dialog = page.getByRole("dialog", { name: "New VPS" });
    const pay = dialog.getByRole("button", { name: "Pay $6.99 & deploy", exact: true });
    await expect(pay).toBeEnabled();
    // Narrow windows must not push the form or its actions sideways.
    await dialog.getByRole("button", { name: "Edit customization" }).click();
    const assertLayout = async () => {
      const geometry = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const footerElement = element.querySelector('[data-slot="dialog-footer"]');
        if (!footerElement) throw new Error("Missing modal footer");
        const footer = footerElement.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          footerBottom: footer.bottom,
          footerTop: footer.top,
          overflow: [
            element,
            ...element.querySelectorAll(
              'form, [data-slot="vps-form-body"], [data-slot="dialog-footer"]',
            ),
          ].some((node) => node.scrollWidth > node.clientWidth + 1),
        };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.left).toBeGreaterThanOrEqual(8);
      expect(geometry.right).toBeLessThanOrEqual(viewport.width - 8);
      expect(geometry.top).toBeGreaterThanOrEqual(8);
      expect(geometry.bottom).toBeLessThanOrEqual(viewport.height - 8);
      expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.bottom);
      expect(geometry.footerTop).toBeGreaterThan(geometry.top);
    };
    await assertLayout();
    await dialog.locator('[data-slot="vps-form-body"]').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: `/tmp/concors-vps-modal-${viewport.width}.png` });
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await dialog.getByRole("button", { name: "Region", exact: true }).click();
    await expect(
      page.getByRole("menuitemradio", { name: "Vint Hill, Virginia", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menu").evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await page.screenshot({ path: `/tmp/concors-vps-regions-${viewport.width}.png` });
    await page.getByRole("menuitemradio", { name: "Hillsboro, Oregon", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Region", exact: true })).toContainText(
      "Hillsboro, Oregon",
    );
    await assertLayout();
    await dialog.locator('[data-slot="vps-form-body"]').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await assertLayout();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await assertLayout();
    await expect(pay).toBeInViewport();
    await expect(dialog.getByText("Stripe test mode", { exact: true })).toHaveCount(0);
    await dialog
      .getByRole("region", { name: "Order summary", exact: true })
      .screenshot({ path: `/tmp/concors-order-summary-${viewport.width}.png` });
  });
}

test("wizard preserves customization and only deploys on final confirmation", async ({ page }) => {
  const state = await billingApi(page, { card: true });
  await openCreation(page);
  expect(state.requests.filter((r) => r.body !== undefined)).toHaveLength(0);
  await page.getByRole("button", { name: "Edit customization" }).click();
  await expect(page.getByRole("checkbox", { name: "Node.js", exact: false })).toBeChecked();
  await page.getByLabel("Node.js version", { exact: true }).selectOption("22");
  await page.getByRole("checkbox", { name: /Docker/ }).check();
  for (const name of ["Python", "Go", "Rust"])
    await page.getByRole("checkbox", { name, exact: true }).check();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("build-agent");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Node.js version", { exact: true })).toHaveValue("22");
  await expect(page.getByRole("checkbox", { name: /Docker/ })).toBeChecked();
  await page.screenshot({ path: "/tmp/vps-wizard-customize.png" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/Node.js \(Node 22\), npm, pnpm, Yarn/)).toBeVisible();
  await expect(page.getByText(/Docker & Compose/)).toBeVisible();
  await page.screenshot({ path: "/tmp/vps-wizard-review.png" });
  expect(state.requests.filter((r) => r.body !== undefined)).toHaveLength(0);
  await page.getByRole("button", { name: "Pay $6.99 & deploy", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    state.requests.filter((r) => r.path.endsWith("/machines") && r.body !== undefined),
  ).toEqual([
    {
      path: "/api/v1/machines",
      body: expect.objectContaining({
        developmentTools: { node: "22", docker: true, python: true, go: true, rust: true },
      }),
    },
  ]);
});

test("creating a VPS never asks for an SSH key and optional tools can be disabled", async ({
  page,
}) => {
  // No saved key: Concors manages the machine with its own key, so none is needed to create one.
  const state = await billingApi(page, { card: true });
  await openCreation(page);
  await page.getByRole("button", { name: "Edit customization" }).click();
  await expect(page.getByRole("textbox", { name: "SSH public key", exact: true })).toHaveCount(0);
  await expect(page.getByText(/Your saved SSH/)).toHaveCount(0);
  await expect(page.getByText(/come preinstalled|build tools are included/)).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Node.js/ }).uncheck();
  await expect(page.getByLabel("Node.js version", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Pay $6.99 & deploy", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    state.requests.filter((r) => r.path.endsWith("/ssh-keys") && r.body !== undefined),
  ).toHaveLength(0);
  expect(
    state.requests.find((r) => r.path.endsWith("/machines") && r.body !== undefined)?.body,
  ).toMatchObject({ developmentTools: { node: null, docker: false } });
});

test("a machine points to Settings for SSH when there is no key", async ({ page }) => {
  await billingApi(page, { ready: true });
  await openMachines(page);
  const card = page.locator("#cloud-machine-vps-1");
  await expect(
    card.getByText("Add an SSH key in Settings to connect from your own terminal.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(card.getByText(/^ssh /)).toHaveCount(0);
  // Only the desktop app can create a key on this computer.
  await expect(card.getByRole("button", { name: "Set up SSH on this computer" })).toHaveCount(0);
});

test("a machine shows its SSH command once a key exists", async ({ page }) => {
  await billingApi(page, { ready: true, savedKey: true });
  await openMachines(page);
  const card = page.locator("#cloud-machine-vps-1");
  await expect(card.getByText("ssh ubuntu@147.135.1.2", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Copy SSH command" })).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`tool picker is compact and keyboard accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await billingApi(page, { card: true, savedKey: true });
    await openCreation(page);
    await page.getByRole("button", { name: "Edit customization" }).click();
    await expect(page.getByRole("checkbox")).toHaveCount(5);
    const python = page.getByRole("checkbox", { name: "Python", exact: true });
    await python.focus();
    await page.keyboard.press("Space");
    await expect(python).toBeChecked();
    await expect(
      page.getByText(/Your saved SSH|come preinstalled|build tools are included/),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeInViewport();
    const dialog = page.getByRole("dialog", { name: "New VPS" });
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await dialog.screenshot({ path: `/tmp/tool-picker-${width}.png` });
  });
}

test("billing and SSH keys stay visible when revisiting settings", async ({ page }) => {
  const state = await billingApi(page, { card: true, savedKey: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Account: E2E User" }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Settings" });
  await navigation.getByRole("button", { name: "Billing", exact: true }).click();
  await expect(page.getByText("4242", { exact: false })).toBeVisible();
  await navigation.getByRole("button", { name: "SSH keys", exact: true }).click();
  await expect(page.getByText("build-agent access", { exact: true })).toBeVisible();
  const reads = state.requests.length;
  await navigation.getByRole("button", { name: "Billing", exact: true }).click();
  await expect(page.getByText("4242", { exact: false })).toBeVisible();
  await expect(page.getByText("Loading billing…", { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await navigation.getByRole("button", { name: "SSH keys", exact: true }).click();
  await expect(page.getByText("build-agent access", { exact: true })).toBeVisible();
  expect(state.requests.length).toBe(reads);
});

// The only warning anyone gets: Stripe emails the cardholder, who may not be the person looking
// at this screen, and the machine is destroyed with its disk when the retries run out.
test("a failed payment warns on the machines page that machines will be deleted", async ({
  page,
}) => {
  await billingApi(page, { card: true, ready: true, paymentFailed: "2026-09-18T10:00:00.000Z" });
  await openMachines(page);

  const warning = page.getByRole("alert", { name: "Payment failed" });
  await expect(warning).toBeVisible();
  await expect(
    warning.getByText("Payment failed — your machines will be deleted", { exact: true }),
  ).toBeVisible();
  await expect(warning).toContainText("permanently deleted");
  await expect(warning).toContainText("cannot be undone");
  // One machine is running, so the copy must not read as if several were at stake.
  await expect(warning).toContainText("your machine will be permanently deleted");

  await expect(page.locator("#cloud-machine-vps-1").getByText("At risk")).toBeVisible();

  const popup = page.waitForEvent("popup");
  await warning.getByRole("button", { name: "Update payment method" }).click();
  expect((await popup).url()).toContain("checkout.stripe.test/portal");
});

test("machines page says nothing about payments while the card works", async ({ page }) => {
  await billingApi(page, { card: true, ready: true });
  await openMachines(page);
  await expect(page.getByRole("heading", { name: "Machines", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("alert", { name: "Payment failed" })).toHaveCount(0);
  await expect(page.locator("#cloud-machine-vps-1").getByText("At risk")).toHaveCount(0);
});
