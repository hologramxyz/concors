import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";

const COMMAND = "curl -fsSL https://api.concors.dev/api/v1/connect/token-1 | sudo bash";
const RENEWED = "curl -fsSL https://api.concors.dev/api/v1/connect/token-2 | sudo bash";

const waiting = {
  id: "own-1",
  organizationId: "e2e-org",
  createdByUserId: "e2e-user",
  name: "home-box",
  provider: "external",
  region: "external",
  size: "external",
  serviceName: null,
  orderId: null,
  status: "provisioning",
  ovhState: null,
  lastError: null,
  ipv4: null,
  ipv6: null,
  sshUser: "ubuntu",
  accessReadyAt: null,
  reinstallTaskId: null,
  monthlyPrice: null,
  paidUntil: null,
  cancelledAt: null,
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  deletedAt: null,
};

const connected = {
  ...waiting,
  status: "running",
  ipv4: "203.0.113.7",
  accessReadyAt: "2026-10-05T00:01:00.000Z",
};

/** The control plane, for an organization whose machines are the person's own servers. */
async function machinesApi(page: Page, initial: (typeof waiting)[] = []) {
  await signedIn(page);
  const state = { machines: initial, requests: [] as { method: string; path: string }[] };
  await page.route("**/api/v1/{machines,billing,ssh-keys}**", async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": request.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname;
    state.requests.push({ method: request.method(), path });
    let status = 200;
    let result: unknown;
    if (path.endsWith("/machines/catalog"))
      result = {
        developmentTools: null,
        regions: [],
        sizes: [],
        image: "Ubuntu 24.04",
        sshUser: "ubuntu",
      };
    else if (path.endsWith("/billing"))
      result = {
        configured: false,
        testMode: false,
        hasPaymentMethod: false,
        card: null,
        paymentFailedAt: null,
        prices: [],
      };
    else if (path.endsWith("/ssh-keys")) result = { sshKeys: [] };
    else if (path.endsWith("/machines/external")) {
      expect(request.postDataJSON()).toEqual({ name: "home-box", organizationId: "e2e-org" });
      state.machines = [waiting];
      status = 201;
      result = { machine: waiting, command: COMMAND };
    } else if (path.endsWith("/connect-command")) result = { machine: waiting, command: RENEWED };
    else if (request.method() === "DELETE") {
      state.machines = [];
      result = { machine: { ...connected, status: "deleted" } };
    } else if (path.endsWith("/machines")) result = { machines: state.machines };
    else throw new Error(`Unexpected API call: ${request.method()} ${path}`);
    await route.fulfill({
      status,
      headers,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  return state;
}

async function openMachines(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage machines", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Machines", exact: true }).first()).toBeVisible();
}

test("connecting your own server hands out its setup command", async ({ page }) => {
  await machinesApi(page);
  await openMachines(page);

  await page.getByRole("button", { name: "New machine", exact: true }).first().click();
  await page.getByRole("menuitem", { name: /^Connect your own server/ }).click();
  const dialog = page.getByRole("dialog", { name: "Connect your own server" });
  await expect(dialog).toContainText("Ubuntu or Debian, on x86_64");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("home-box");
  await dialog.getByRole("button", { name: "Get setup command", exact: true }).click();

  const added = page.getByRole("dialog", { name: "Connect home-box" });
  await expect(added.getByText(COMMAND, { exact: true })).toBeVisible();
  await expect(added.getByRole("button", { name: "Copy setup command" })).toBeVisible();
  await expect(added.getByRole("status")).toContainText("Waiting for your server");
  await added.getByRole("button", { name: "Done", exact: true }).click();

  const card = page.locator("#cloud-machine-own-1");
  await expect(card).toContainText("Your own server");
  await expect(card).toContainText("Waiting for server");
  // Nothing about a price, a size or a renewal: the server is not Concors'.
  await expect(card).not.toContainText("/month");
  await expect(card).not.toContainText("Renews on");
});

test("a server still waiting can get a new setup command", async ({ page }) => {
  const state = await machinesApi(page, [waiting]);
  await openMachines(page);

  await page
    .locator("#cloud-machine-own-1")
    .getByRole("button", { name: "Show setup command", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Connect home-box" }).getByText(RENEWED, { exact: true }),
  ).toBeVisible();
  expect(state.requests).toContainEqual({
    method: "POST",
    path: "/api/v1/machines/own-1/connect-command",
  });
});

test("removing your own server says what stays on it", async ({ page }) => {
  const state = await machinesApi(page, [connected]);
  await openMachines(page);

  await page.getByRole("button", { name: "Remove home-box", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remove home-box?" });
  await expect(dialog).toContainText("The server itself, your files and your own SSH keys stay");
  await dialog.getByRole("button", { name: "Remove machine", exact: true }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#cloud-machine-own-1")).toHaveCount(0);
  expect(state.requests).toContainEqual({ method: "DELETE", path: "/api/v1/machines/own-1" });
});
