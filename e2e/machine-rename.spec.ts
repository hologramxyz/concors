import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
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
    paidUntil: null,
    cancelledAt: null,
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
  };

  let fail = false;
  let writes = 0;
  let finishSave: (() => void) | undefined;
  let holdSave = false;
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
      body = {
        regions: [],
        sizes: [],
        image: "ubuntu",
        sshUser: "ubuntu",
      };
    else if (path === "/api/v1/machines/m1" && request.method() === "PATCH") {
      writes++;
      if (holdSave)
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
      if (fail) {
        status = 409;
        body = { message: 'A machine named "production" already exists in this organization' };
      } else {
        machine.name = (request.postDataJSON() as { name: string }).name;
        body = { machine };
      }
    }
    return route.fulfill({
      status,
      headers,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  const navigate = async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Switch machine" }).click();
    await page.getByRole("menuitem", { name: "Manage machines" }).click();
    await expect(page.getByRole("heading", { name: "Machines", level: 2 })).toBeVisible();
  };
  await navigate();
  return {
    writes: () => writes,
    fail: (value: boolean) => {
      fail = value;
    },
    hold: () => {
      holdSave = true;
    },
    finish: () => {
      finishSave?.();
      holdSave = false;
    },
    navigate,
  };
}

test("rename supports keyboard editing, validation, cancellation, and persistence", async ({
  page,
}) => {
  const fixture = await setup(page);
  const trigger = page.getByRole("button", { name: "Rename test-vps-3", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename machine" });
  const input = dialog.getByRole("textbox", { name: "Machine name" });
  const save = dialog.getByRole("button", { name: "Save name" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("test-vps-3");
  expect(
    await input.evaluate(
      (el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0),
    ),
  ).toBe(10);
  await expect(save).toBeDisabled();
  for (const invalid of ["", "UPPER", "has spaces", "-leading", "trailing-"]) {
    await input.fill(invalid);
    await expect(save).toBeDisabled();
    await expect(input).toHaveAttribute("aria-invalid", "true");
  }
  await input.fill("discard-me");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(fixture.writes()).toBe(0);
  await trigger.click();
  await expect(input).toHaveValue("test-vps-3");
  await input.fill("also-discard-me");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(fixture.writes()).toBe(0);
  await trigger.click();
  await input.fill("production");
  await input.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "production", exact: true })).toBeVisible();
  expect(fixture.writes()).toBe(1);
  await fixture.navigate();
  await expect(page.getByRole("heading", { name: "production", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/machine-renamed.png" });
});

test("rename keeps errors and drafts visible and prevents duplicate saves", async ({ page }) => {
  const fixture = await setup(page);
  await page.setViewportSize({ width: 800, height: 850 });
  await page.getByRole("button", { name: "Rename test-vps-3" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename machine" });
  const input = dialog.getByRole("textbox", { name: "Machine name" });
  fixture.fail(true);
  await input.fill("production");
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await expect(input).toHaveValue("production");
  await expect(
    page.getByRole("heading", { name: "test-vps-3", exact: true, includeHidden: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/machine-rename-error.png" });
  fixture.fail(false);
  fixture.hold();
  await input.fill("production-2");
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(input).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect.poll(fixture.writes).toBe(2);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  fixture.finish();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "production-2", exact: true })).toBeVisible();
  expect(fixture.writes()).toBe(2);
});
