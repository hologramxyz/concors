import { test, expect, type Page } from "@playwright/test";

const TOKEN_KEY = "concors.auth.session-token.v1";
const PASSWORD = "correct-horse-battery";
const USER = {
  id: "u1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  emailVerified: true,
  image: null,
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
};
const ORG = {
  id: "org1",
  name: "ada",
  slug: "ada",
  logo: null,
  isPersonal: true,
  role: "owner",
  createdAt: "2026-09-07T00:00:00.000Z",
};

/**
 * Stands in for concors-server: the whole auth flow is exercised against the real UI with the API
 * mocked at the network layer. Behaves like Better Auth + the `/api/v1` routes, including CORS
 * preflights in case the app is configured with a cross-origin API URL.
 */
async function mockApi(page: Page) {
  const state = { user: { ...USER }, signedIn: false, bearer: [] as (string | null)[] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const origin = request.headers()["origin"] ?? "*";
    const cors = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/me") {
      state.bearer.push(request.headers()["authorization"] ?? null);
      return state.signedIn
        ? json(200, {
            user: state.user,
            session: {
              id: "s1",
              expiresAt: "2026-10-07T00:00:00.000Z",
              activeOrganizationId: ORG.id,
            },
          })
        : json(401, { statusCode: 401, error: "Unauthorized", message: "Authentication required" });
    }
    if (path === "/api/v1/organizations") return json(200, { organizations: [ORG] });
    if (path === "/api/auth/sign-in/email") {
      const body = request.postDataJSON() as { email: string; password: string };
      if (body.password !== PASSWORD)
        return json(401, {
          message: "Invalid email or password",
          code: "INVALID_EMAIL_OR_PASSWORD",
        });
      state.signedIn = true;
      return json(200, { redirect: false, token: "e2e-session-token", user: state.user });
    }
    if (path === "/api/auth/sign-up/email") {
      const body = request.postDataJSON() as { name: string; email: string; password: string };
      state.user = { ...USER, id: "u2", name: body.name, email: body.email, emailVerified: false };
      state.signedIn = true;
      return json(200, { token: "e2e-signup-token", user: state.user });
    }
    if (path === "/api/auth/sign-out") {
      state.signedIn = false;
      return json(200, { success: true });
    }
    return json(404, { statusCode: 404, error: "Not Found", message: `no mock for ${path}` });
  });
  return state;
}

test("authentication forms remain scrollable in short windows", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 640, height: 320 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to Concourse" })).toBeVisible();
  const main = page.getByRole("main");
  for (const mode of ["sign-in", "sign-up"] as const) {
    if (mode === "sign-up") {
      await page.getByRole("button", { name: "Create an account", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Create your Concourse account" }),
      ).toBeVisible();
    }
    await main.evaluate((element) => {
      element.scrollTop = 0;
    });
    expect(
      await page
        .getByText("concors", { exact: true })
        .evaluate((element) => element.getBoundingClientRect().top),
      `${mode} branding must be reachable at the top of the scroll area`,
    ).toBeGreaterThanOrEqual(0);
    const submit = page.getByRole("button", {
      name: mode === "sign-in" ? "Sign in" : "Create account",
      exact: true,
    });
    await submit.scrollIntoViewIfNeeded();
    const bounds = await submit.boundingBox();
    expect(bounds).not.toBeNull();
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(320);
    expect(await main.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: "test-results/auth-short-window.png" });
});

test("the app is gated behind sign-in: sign in, restore on reload, sign out, create an account", async ({
  page,
}) => {
  const api = await mockApi(page);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  const signInHeading = page.getByRole("heading", { name: "Sign in to Concourse" });

  // Signed out: only the sign-in screen exists. A stale saved token is rejected and dropped.
  await page.goto("/");
  await expect(signInHeading).toBeVisible();
  await expect(sidebar).toHaveCount(0);
  await page.evaluate((key) => localStorage.setItem(key, "stale-token"), TOKEN_KEY);
  await page.reload();
  await expect(signInHeading).toBeVisible();
  await expect(sidebar).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBeNull();
  expect(api.bearer.at(-1)).toBe("Bearer stale-token");

  // Wrong password → readable error, still on the sign-in screen.
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Incorrect email or password.");
  await expect(sidebar).toHaveCount(0);

  // Right password → the app appears, token persisted and used as a bearer credential.
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: `Account: ${USER.name}` })).toBeVisible();
  await expect(signInHeading).toHaveCount(0);
  await expect(sidebar.getByText(USER.email)).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBe(
    "e2e-session-token",
  );
  expect(api.bearer.at(-1)).toBe("Bearer e2e-session-token");

  // Settings shows the account and its organization.
  await sidebar.getByRole("button", { name: `Account: ${USER.name}` }).click();
  await expect(page.getByRole("menu").getByText(USER.email)).toBeVisible();
  const menu = page.getByRole("menu");
  const nameBounds = await menu.getByText(USER.name, { exact: true }).boundingBox();
  const emailBounds = await menu.getByText(USER.email, { exact: true }).boundingBox();
  expect(emailBounds?.y).toBeGreaterThan(nameBounds?.y ?? 0);
  await expect(menu.getByRole("menuitem", { name: "Settings", exact: true })).toHaveCSS(
    "font-size",
    "13px",
  );
  await expect(menu.getByRole("menuitem", { name: "Sign out", exact: true })).toHaveCSS(
    "font-size",
    "13px",
  );

  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByText(ORG.name, { exact: true })).toBeVisible();

  // The session survives a reload: straight into the app, no sign-in screen.
  await page.reload();
  await expect(sidebar.getByRole("button", { name: `Account: ${USER.name}` })).toBeVisible();
  await expect(signInHeading).toHaveCount(0);

  // Sign out from the account menu → back to the sign-in screen, token gone.
  await sidebar.getByRole("button", { name: `Account: ${USER.name}` }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(signInHeading).toBeVisible();
  await expect(sidebar).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBeNull();
  await page.reload();
  await expect(signInHeading).toBeVisible();

  // Create an account from the same screen.
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Create your Concourse account" })).toBeVisible();
  await page.getByLabel("Name").fill("Grace Hopper");
  await page.getByLabel("Email").fill("grace@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(sidebar.getByRole("button", { name: "Account: Grace Hopper" })).toBeVisible();
  await sidebar.getByRole("button", { name: "Account: Grace Hopper" }).click();
  await expect(page.getByRole("menu").getByText("grace@example.com")).toBeVisible();
});
