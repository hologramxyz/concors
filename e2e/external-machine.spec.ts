import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";

const COMMAND = "curl -fsSL https://api.concors.dev/api/v1/connect/token-1 | sudo bash";
const RENEWED = "curl -fsSL https://api.concors.dev/api/v1/connect/token-2 | sudo bash";

const waiting: Record<string, unknown> & { id: string } = {
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
async function machinesApi(page: Page, initial: Record<string, unknown>[] = []) {
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

test("connecting your own server hands out its setup command and follows the setup", async ({
  page,
}) => {
  const state = await machinesApi(page);
  await openMachines(page);

  await page.getByRole("button", { name: "New machine", exact: true }).first().click();
  await page.getByRole("menuitem", { name: /^Connect your own server/ }).click();
  const dialog = page.getByRole("dialog", { name: "Connect your own server" });
  // Requirements are there for whoever wants them, folded away.
  const servers = dialog.getByText("Which servers work?", { exact: true });
  await expect(dialog.getByText("uname -m", { exact: true })).toBeHidden();
  await servers.click();
  await expect(dialog.getByText("uname -m", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("ARM servers aren't supported yet");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Home-Box");
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("home-box");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();

  const added = page.getByRole("dialog", { name: "Connect home-box" });
  await expect(added.getByText(COMMAND, { exact: true })).toBeVisible();
  await expect(added.getByRole("button", { name: "Copy setup command" })).toBeVisible();
  const progress = added.getByRole("status", { name: "Setup progress" });
  await expect(progress).toContainText("Waiting for your server");

  // The dialog re-reads the machine every few seconds and moves along with it.
  state.machines = [{ ...connected, agentInstalledAt: null }];
  await expect(progress).toContainText("Server connected", { timeout: 10_000 });
  await expect(progress).toContainText("Installing Concors");
  state.machines = [{ ...connected, agentInstalledAt: "2026-10-05T00:03:00.000Z" }];
  await expect(progress).toContainText("home-box is ready", { timeout: 10_000 });
  await added.getByRole("button", { name: "Done", exact: true }).click();

  const card = page.locator("#cloud-machine-own-1");
  await expect(card).toContainText("Your own server");
  await expect(card).toContainText("Running");
  // Nothing about a price, a size or a renewal: the server is not Concors'.
  await expect(card).not.toContainText("/month");
  await expect(card).not.toContainText("Renews on");
});

test("a failed attempt shows in the app, next to the command", async ({ page }) => {
  const reason = "Concors could not log in to 203.0.113.7 over SSH (port 22) as ubuntu with sudo";
  await machinesApi(page, [{ ...waiting, lastError: reason }]);
  await openMachines(page);

  const card = page.locator("#cloud-machine-own-1");
  await expect(card).toContainText("The last attempt didn't work");
  await expect(card).toContainText(reason);
  await expect(card).toContainText("run the same setup command again");
  await card.getByRole("button", { name: "Show setup command", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Connect home-box" }).getByRole("status", {
      name: "Setup progress",
    }),
  ).toContainText(reason);
});

test("a connected server shows Concors installing, and any problem with it", async ({ page }) => {
  await machinesApi(page, [
    { ...connected, agentInstalledAt: null, agentError: "the server ran out of disk space" },
  ]);
  await openMachines(page);

  const card = page.locator("#cloud-machine-own-1");
  await expect(card).toContainText("Setting up");
  await expect(card).toContainText("Installing Concors hit a problem");
  await expect(card).toContainText("the server ran out of disk space");
  await expect(card).toContainText("tries again by itself");
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

test("a server behind a router shows it goes through the relay", async ({ page }) => {
  await machinesApi(page, [{ ...connected, ipv4: null, connection: "relay" }]);
  await openMachines(page);

  const card = page.locator("#cloud-machine-own-1");
  await expect(card).toContainText("Through the Concors relay");
  await card.getByText("Through the Concors relay").first().hover();
  await expect(page.getByRole("tooltip")).toContainText("encrypted end to end");
  await card.getByText("Advanced", { exact: true }).click();
  await expect(card).toContainText("plain SSH from this computer doesn't reach it");
  await expect(card.getByRole("button", { name: "Copy SSH command" })).toHaveCount(0);
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
