import { expect, test, type Page } from "@playwright/test";
import { signedIn } from "./signed-in.ts";
import { managedHost } from "./support/managed-host.ts";

const LONG_NAME = "my-production-server-with-a-very-long-name-for-the-team";
async function fixture(page: Page) {
  await signedIn(page);
  await managedHost(page);
  let icon: string | null = null;
  let fail = false;
  const machine = () => ({
    id: "second-machine",
    organizationId: "e2e-org",
    createdByUserId: "e2e-user",
    name: LONG_NAME,
    icon,
    region: "US-EAST-VA",
    size: "large",
    serviceName: null,
    orderId: null,
    status: "running",
    ovhState: null,
    lastError: null,
    ipv4: "192.0.2.1",
    ipv6: null,
    sshUser: "ubuntu",
    accessReadyAt: null,
    reinstallTaskId: null,
    monthlyPrice: null,
    paidUntil: null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    hostname: "second.example",
    agentSeenAt: new Date().toISOString(),
    agentVersion: "0.2.0",
  });
  await page.route("**/api/v1/machines**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "access-control-allow-origin": request.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, PATCH, POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path.endsWith("/token")) return route.fallback();
    if (path.endsWith("/icon")) {
      if (fail)
        return route.fulfill({ status: 503, headers, json: { message: "Could not save icon" } });
      icon = request.postDataJSON().icon;
      return route.fulfill({ headers, json: { machine: machine() } });
    }
    if (path.endsWith("/catalog"))
      return route.fulfill({
        headers,
        json: { regions: [], sizes: [], image: "Ubuntu 24.04", sshUser: "ubuntu" },
      });
    return route.fulfill({ headers, json: { machines: [machine()] } });
  });
  await page.goto("/");
  return {
    icon: () => icon,
    fail: (next: boolean) => {
      fail = next;
    },
  };
}
async function manage(page: Page) {
  await page.getByRole("button", { name: "Switch machine" }).click();
  await page.getByRole("menuitem", { name: "Manage machines", exact: true }).click();
}

test("machine icons persist, update the selected switcher, and reset", async ({ page }) => {
  const state = await fixture(page);
  const trigger = page.getByRole("button", { name: "Switch machine" });
  await expect(trigger.locator('[data-machine-icon="local"]')).toBeVisible();
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect.poll(async () => (await menu.boundingBox())?.width).toBe(200);
  const width = 200;
  const server = page.getByRole("menuitem", { name: new RegExp(LONG_NAME) });
  await expect(server).toBeVisible();
  expect(
    await server.getByTitle(LONG_NAME).evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await expect(server).not.toContainText("Online");
  await server.click();
  await expect(trigger).toContainText(LONG_NAME);
  await manage(page);
  const local = page.getByLabel("Local machine", { exact: true });
  await expect(local.getByRole("heading", { name: "This computer" })).toBeVisible();
  await expect(local).not.toContainText(/Memory|Disk/);
  await page.getByRole("button", { name: `Change icon for ${LONG_NAME}` }).click();
  const picker = page.getByRole("dialog", { name: "Customize machine icon" });
  await picker.getByRole("button", { name: "Rocket", exact: true }).click();
  await picker.getByRole("button", { name: "Save icon", exact: true }).click();
  await expect(picker).toHaveCount(0);
  expect(state.icon()).toBe("🚀");
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await expect(trigger.locator('[data-machine-icon="custom"]')).toHaveText("🚀");
  await trigger.click();
  await expect(server.locator('[data-machine-icon="custom"]')).toHaveText("🚀");
  await expect.poll(async () => (await menu.boundingBox())?.width).toBe(width);
  await expect(server).not.toContainText("Connected");
  await page.screenshot({ path: test.info().outputPath("machine-switcher.png") });
  await page.keyboard.press("Escape");
  await page.reload();
  await manage(page);
  const iconButton = page.getByRole("button", { name: `Change icon for ${LONG_NAME}` });
  await expect(iconButton.locator('[data-machine-icon="custom"]')).toHaveText("🚀");
  await iconButton.click();
  await picker.getByRole("button", { name: "Reset to default" }).click();
  await picker.getByRole("button", { name: "Save icon" }).click();
  await expect(iconButton.locator('[data-machine-icon="server"]')).toBeVisible();
  expect(state.icon()).toBeNull();
  await local.getByRole("button", { name: "Use this computer" }).click();
  await expect(trigger.locator('[data-machine-icon="local"]')).toBeVisible();
});

test("icon picker handles custom emoji, errors, keyboard use, and narrow layouts", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await manage(page);
  const trigger = page.getByRole("button", { name: `Change icon for ${LONG_NAME}` });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Customize machine icon" });
  await expect(picker).toBeInViewport();
  const input = picker.getByRole("textbox", { name: "Custom emoji" });
  await input.fill("not an emoji");
  const save = picker.getByRole("button", { name: "Save icon" });
  await expect(save).toBeDisabled();
  await input.fill("👩🏽‍💻");
  await page.screenshot({ path: test.info().outputPath("machine-icon-picker.png") });
  state.fail(true);
  await save.click();
  await expect(picker.getByRole("alert")).toContainText("Could not save icon");
  await expect(input).toHaveValue("👩🏽‍💻");
  expect(state.icon()).toBeNull();
  state.fail(false);
  await save.click();
  await expect(picker).toHaveCount(0);
  await expect(trigger.locator('[data-machine-icon="custom"]')).toHaveText("👩🏽‍💻");
  await expect(trigger).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("machine-card-narrow.png") });
});
