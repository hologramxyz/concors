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
  options: { card?: boolean; unpriced?: boolean; decline?: boolean } = {},
) {
  await signedIn(page);
  const state = {
    card: options.card ?? false,
    complete: false,
    created: false,
    keyAdded: false,
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
        paymentFailedAt: null,
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
        expect(state.keyAdded).toBe(true);
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
      } else result = { machines: state.created ? [machine] : [] };
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

async function openCreation(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add a machine", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Machines", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "New machine", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "New VPS" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("build-agent");
  await page.getByRole("textbox", { name: "SSH public key", exact: true }).fill(key);
}

test("create a workspace VPS with a test card, then view its subscription in Profile", async ({
  page,
}) => {
  const state = await billingApi(page);
  await openCreation(page);
  const pay = page.getByRole("button", { name: "Pay $6.99/month and create VPS", exact: true });
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
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /build-agent provisioning/i })).toBeVisible();
  await page.getByRole("menuitem", { name: /build-agent provisioning/i }).click();
  await expect(page.locator("#cloud-machine-vps-1")).toBeVisible();

  await page.getByRole("button", { name: "Account: E2E User" }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
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
  await page.getByRole("button", { name: "Pay $6.99/month and create VPS", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your card was declined");
  await expect(page.getByRole("dialog", { name: "New VPS" })).toBeVisible();
  expect(state.created).toBe(false);
});

test("missing Stripe prices cannot be mistaken for a free VPS", async ({ page }) => {
  const state = await billingApi(page, { card: true, unpriced: true });
  await openCreation(page);
  await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Create VPS", exact: true })).toBeDisabled();
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
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("build-agent");
  await expect(page.getByRole("button", { name: "Add a card with Stripe" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Pay $6.99/month and create VPS", exact: true }),
  ).toBeDisabled();
  expect(state.created).toBe(false);
});

test("existing cloud machines appear directly in the switcher and refresh when reopened", async ({
  page,
}) => {
  const state = await billingApi(page);
  state.created = true;
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /build-agent provisioning/i })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "This computer Selected", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  state.created = false;
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /build-agent provisioning/i })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Add a machine", exact: true })).toBeVisible();
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
    const pay = dialog.getByRole("button", { name: "Pay $6.99/month and create VPS", exact: true });
    await expect(pay).toBeEnabled();
    // Long keys and narrow windows must not push the form or its actions sideways.
    await page
      .getByRole("textbox", { name: "SSH public key" })
      .fill(`${key} ${"workstation".repeat(30)}`);
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
    await expect(pay).toBeInViewport();
    await expect(dialog.getByText("Stripe test mode", { exact: true })).toHaveCount(0);
    await dialog
      .getByRole("region", { name: "Order summary", exact: true })
      .screenshot({ path: `/tmp/concors-order-summary-${viewport.width}.png` });
  });
}
