import { expect, test } from "@playwright/test";

test("a machine offers its pending daemon update, confirms first, and shows it installing", async ({
  page,
}) => {
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
  const machine: Record<string, unknown> = {
    id: "m1",
    organizationId: "o1",
    createdByUserId: "u1",
    name: "test-vps-3",
    region: "US-EAST-VA",
    size: "small",
    serviceName: "vps-1",
    orderId: "1",
    status: "running",
    ovhState: "running",
    lastError: null,
    ipv4: "192.0.2.1",
    ipv6: null,
    agentVersion: "0.6.14",
    daemonUpdate: { version: "0.7.0", installing: false },
    sshUser: "ubuntu",
    accessReadyAt: time,
    reinstallTaskId: null,
    monthlyPrice: { amount: 6.99, currency: "USD" },
    paidUntil: null,
    cancelledAt: null,
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  };
  let refuse: string | null = null;
  let requests = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "access-control-allow-origin": request.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let body: unknown = {};
    let status = 200;
    if (path === "/api/v1/me")
      body = {
        user,
        session: { id: "s1", expiresAt: "2099-01-01T00:00:00Z", activeOrganizationId: "o1" },
      };
    else if (path === "/api/v1/organizations") body = { organizations: [org] };
    else if (path === "/api/v1/machines") body = { machines: [machine] };
    else if (path === "/api/v1/machines/catalog")
      body = { regions: [], sizes: [], image: "ubuntu", sshUser: "ubuntu" };
    else if (path === "/api/v1/machines/m1/daemon/update" && request.method() === "POST") {
      requests++;
      if (refuse) {
        status = 409;
        body = { message: refuse };
      } else {
        machine["daemonUpdate"] = { version: "0.7.0", installing: true };
        return route.fulfill({ status: 202, headers });
      }
    }
    return route.fulfill({
      status,
      headers,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine" }).click();
  await page.getByRole("menuitem", { name: "Manage machines" }).click();
  await expect(page.getByRole("heading", { name: "Machines", level: 2 })).toBeVisible();

  const notice = page.getByRole("group", { name: "Update available" });
  await expect(notice).toContainText("Update available: version 0.7.0");
  await expect(notice).toContainText(
    "It installs by itself when no agent on this machine is working or waiting for you.",
  );
  const updateNow = notice.getByRole("button", { name: "Update now", exact: true });
  await page.screenshot({ path: "test-results/machine-daemon-update.png" });

  // Nothing is asked of the server until the owner confirms.
  await updateNow.click();
  const dialog = page.getByRole("dialog", { name: "Update test-vps-3 now?" });
  await expect(dialog).toContainText(
    "Updating restarts this machine's agents. Anything they're doing right now will stop; your conversations are kept.",
  );
  await page.screenshot({
    path: "test-results/machine-daemon-update-confirm.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(updateNow).toBeFocused();
  expect(requests).toBe(0);

  // A refusal stays in the dialog, in the server's words.
  refuse = "This machine is already running the latest daemon";
  await updateNow.click();
  await dialog.getByRole("button", { name: "Update now", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "This machine is already running the latest daemon",
  );
  expect(requests).toBe(1);

  refuse = null;
  await dialog.getByRole("button", { name: "Update now", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests).toBe(2);
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Updating to version 0.7.0" }),
  ).toContainText("Your conversations are kept.");
  await expect(page.getByRole("button", { name: "Update now" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/machine-daemon-updating.png" });

  // Once the new version reports in, the control plane clears the update.
  machine["daemonUpdate"] = null;
  machine["agentVersion"] = "0.7.0";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Updating to version 0.7.0")).toHaveCount(0);
  await expect(notice).toHaveCount(0);
});
