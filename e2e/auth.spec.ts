import { test, expect, type Page } from "@playwright/test";

const TOKEN_KEY = "concors.auth.session-token.v1";
const SESSION_TOKEN = "e2e-session-token";
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
 * Stands in for concors-server: the session half of auth is exercised against the real UI with the
 * API mocked at the network layer, including CORS preflights in case the app is configured with a
 * cross-origin API URL. Signing in itself happens in the system browser, which a browser preview
 * cannot drive, so a session starts as a saved token — exactly what that flow leaves behind.
 */
async function mockApi(page: Page) {
  const state = { sessions: new Set([SESSION_TOKEN]), bearer: [] as (string | null)[] };
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
    const authorization = request.headers()["authorization"] ?? null;
    const token = authorization?.replace(/^Bearer /, "") ?? "";
    if (path === "/api/v1/me") {
      state.bearer.push(authorization);
      return state.sessions.has(token)
        ? json(200, {
            user: USER,
            session: {
              id: "s1",
              expiresAt: "2026-10-07T00:00:00.000Z",
              activeOrganizationId: ORG.id,
            },
          })
        : json(401, { statusCode: 401, error: "Unauthorized", message: "Authentication required" });
    }
    if (path === "/api/v1/organizations") return json(200, { organizations: [ORG] });
    if (path === "/api/auth/sign-out") {
      state.sessions.delete(token);
      return json(200, { success: true });
    }
    return json(404, { statusCode: 404, error: "Not Found", message: `no mock for ${path}` });
  });
  return state;
}

test("the sign-in screen remains scrollable in short windows", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 640, height: 320 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to Concors" })).toBeVisible();
  const main = page.getByRole("main");
  await main.evaluate((element) => {
    element.scrollTop = 0;
  });
  expect(
    await page
      .getByText("concors", { exact: true })
      .evaluate((element) => element.getBoundingClientRect().top),
    "branding must be reachable at the top of the scroll area",
  ).toBeGreaterThanOrEqual(0);
  // A browser preview cannot receive the sign-in callback, so it explains that instead.
  const explanation = page.getByText(/only the Concors desktop app can do/);
  await explanation.scrollIntoViewIfNeeded();
  const bounds = await explanation.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(320);
  expect(await main.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/auth-short-window.png" });
});

test("the app is gated behind sign-in: restore a saved session, reload, sign out", async ({
  page,
}) => {
  const api = await mockApi(page);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  const signInHeading = page.getByRole("heading", { name: "Sign in to Concors" });

  // Signed out: only the sign-in screen exists, offering no form of its own.
  await page.goto("/");
  await expect(signInHeading).toBeVisible();
  await expect(sidebar).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);

  // A stale saved token is rejected and dropped.
  await page.evaluate((key) => localStorage.setItem(key, "stale-token"), TOKEN_KEY);
  await page.reload();
  await expect(signInHeading).toBeVisible();
  await expect(sidebar).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBeNull();
  expect(api.bearer.at(-1)).toBe("Bearer stale-token");

  // A valid saved token → straight into the app, the token used as a bearer credential.
  await page.evaluate(
    ([key, token]) => localStorage.setItem(key, token),
    [TOKEN_KEY, SESSION_TOKEN],
  );
  await page.reload();
  await expect(sidebar.getByRole("button", { name: `Account: ${USER.name}` })).toBeVisible();
  await expect(signInHeading).toHaveCount(0);
  await expect(sidebar.getByText(USER.email)).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  expect(api.bearer.at(-1)).toBe(`Bearer ${SESSION_TOKEN}`);

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

  // Sign out from the account menu → back to the sign-in screen, token gone and revoked.
  await sidebar.getByRole("button", { name: `Account: ${USER.name}` }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(signInHeading).toBeVisible();
  await expect(sidebar).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBeNull();
  await expect.poll(() => api.sessions.has(SESSION_TOKEN)).toBe(false);
  await page.reload();
  await expect(signInHeading).toBeVisible();
});
