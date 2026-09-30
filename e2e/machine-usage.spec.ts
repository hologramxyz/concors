import { expect, test } from "@playwright/test";

test("machine cards display usage, poll, and identify stale or missing reports", async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("concors.auth.session-token.v1", "fixture"));
  const time = new Date().toISOString();
  const user = {
    id: "u1",
    name: "Ada",
    email: "ada@example.com",
    emailVerified: true,
    image: null,
    createdAt: time,
    updatedAt: time,
  };
  const org = {
    id: "o1",
    name: "ada",
    slug: "ada",
    logo: null,
    isPersonal: true,
    role: "owner",
    createdAt: time,
  };
  const machine = {
    id: "m1",
    organizationId: "o1",
    createdByUserId: "u1",
    name: "test-vps-3",
    region: "US-EAST-VA",
    size: "small",
    serviceName: null,
    orderId: null,
    status: "running",
    ovhState: null,
    lastError: null,
    ipv4: "192.0.2.1",
    ipv6: null,
    sshUser: "ubuntu",
    accessReadyAt: time,
    reinstallTaskId: null,
    monthlyPrice: { amount: 6.99, currency: "USD" },
    paidUntil: "2026-10-18T00:00:00.000Z",
    cancelledAt: null,
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  };
  let usage: {
    sampledAt: string;
    memory: { totalBytes: number; availableBytes: number } | null;
    disk: { totalBytes: number; availableBytes: number } | null;
  } | null = {
    sampledAt: time,
    memory: { totalBytes: 8 * 1024 ** 3, availableBytes: 3 * 1024 ** 3 },
    disk: { totalBytes: 40 * 1024 ** 3, availableBytes: 30 * 1024 ** 3 },
  };
  let fail = false,
    reads = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = {
      "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let body: unknown = {};
    if (path === "/api/v1/me")
      body = {
        user,
        session: { id: "s1", expiresAt: "2099-01-01T00:00:00Z", activeOrganizationId: "o1" },
      };
    else if (path === "/api/v1/organizations") body = { organizations: [org] };
    else if (path === "/api/v1/machines") {
      reads++;
      if (fail) return route.fulfill({ status: 503, headers, body: "Unavailable" });
      body = { machines: [{ ...machine, resourceUsage: usage }] };
    } else if (path === "/api/v1/machines/catalog")
      body = {
        regions: [{ id: "US-EAST-VA", location: "Vint Hill, Virginia", countryCode: "US" }],
        sizes: [],
        image: "ubuntu",
        sshUser: "ubuntu",
      };
    return route.fulfill({
      status: 200,
      headers,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine" }).click();
  await page.getByRole("menuitem", { name: "Manage machines" }).click();
  await expect(page.getByRole("heading", { name: "Machines", level: 2 })).toBeVisible();
  const create = page.getByRole("button", { name: "New machine", exact: true });
  await expect(create).toBeEnabled();
  const colors = await create.evaluate((element) => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(colors.foreground).not.toBe(colors.background);
  expect((await create.boundingBox())?.height).toBeGreaterThanOrEqual(28);
  await expect(page.getByText("Vint Hill, Virginia", { exact: true })).toBeVisible();
  await expect(page.getByText("Renews on", { exact: true })).toBeVisible();
  await expect(page.getByText("Paid until", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/refreshes every 30 seconds/i)).toHaveCount(0);
  await expect(page.getByText(/Development tools ready/i)).toHaveCount(0);
  // This computer has an Advanced section of its own, for its daemon; SSH access is the cloud
  // machine's.
  const advanced = page
    .locator("details")
    .filter({ hasText: "Advanced" })
    .filter({ hasText: "SSH access" });
  await expect(advanced.getByText("SSH access", { exact: true })).toBeHidden();
  await advanced.locator("summary").click();
  await expect(advanced.getByText("SSH access", { exact: true })).toBeVisible();
  const memory = page.getByRole("meter", { name: "Memory usage" });
  await expect(memory).toHaveAttribute("aria-valuenow", "63");
  await expect(page.getByRole("meter", { name: "Disk usage" })).toHaveAttribute(
    "aria-valuenow",
    "25",
  );
  await expect(page.getByText("5.0 GiB / 8.0 GiB used")).toBeVisible();
  await page.screenshot({ path: "test-results/machine-resource-usage.png" });
  await page.setViewportSize({ width: 800, height: 850 });
  await expect(create).toBeInViewport();
  expect(
    await page.locator("[data-machines-view]").evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "test-results/machines-narrow.png" });
  await page.setViewportSize({ width: 1360, height: 850 });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const lightColors = await create.evaluate((el) => ({
    foreground: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor,
  }));
  expect(lightColors.foreground).not.toBe(lightColors.background);
  await page.screenshot({ path: "test-results/machines-light.png" });
  const before = reads;
  usage = { ...usage, memory: { totalBytes: 8 * 1024 ** 3, availableBytes: 4 * 1024 ** 3 } };
  await page.clock.fastForward(31000);
  await expect(memory).toHaveAttribute("aria-valuenow", "50");
  expect(reads).toBeGreaterThan(before);
  fail = true;
  await page.clock.fastForward(90000);
  await expect(page.getByText(/Out of date · last updated/)).toBeVisible();
  await expect(memory).toHaveAttribute("aria-valuetext", "50%, last reported");
  fail = false;
  usage = { ...usage, sampledAt: await page.evaluate(() => new Date().toISOString()), disk: null };
  await page.clock.fastForward(31000);
  await expect(page.getByRole("meter", { name: "Disk usage" })).toHaveCount(0);
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  usage = null;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/Usage unavailable/)).toBeVisible();
  await expect(page.getByRole("meter")).toHaveCount(0);
});
