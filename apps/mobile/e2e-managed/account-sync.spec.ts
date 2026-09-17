import type { Page, FrameLocator } from "@playwright/test";
import { test, expect, signedIn } from "../../../e2e/signed-in";
import { managedHost } from "../../../e2e/support/managed-host";
import { demoMachine, demoMe } from "../src/demo/fixtures";

const uiFor = (page: Page) => page.frameLocator('iframe[title="Concors workspace"]');
const sheet = (ui: FrameLocator, name: string) => ui.getByRole("dialog", { name, exact: true });
async function close(ui: FrameLocator, name: string) {
  await sheet(ui, name).getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet(ui, name)).toHaveCount(0);
}
async function account(ui: FrameLocator) {
  if (await ui.getByRole("button", { name: "Open sidebar", exact: true }).isVisible())
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Account: E2E User", exact: true }).click();
  return sheet(ui, "Account");
}
async function fixture(page: Page) {
  await signedIn(page);
  await managedHost(page, true);
  let activeOrganization = "e2e-org";
  let rejectSwitch = false;
  let rejectIcon = false;
  let connected = true;
  let githubReads = 0;
  let accountsReads = 0;
  let reposReads = 0;
  const preparations: { path: string; body: unknown }[] = [];
  const machine = {
    ...demoMachine,
    id: "second-machine",
    organizationId: "e2e-org",
    name: "build-server",
    icon: "🚀",
    hostname: "second.example",
    agentSeenAt: new Date().toISOString(),
  };
  const teamMachine = {
    ...machine,
    id: "team-machine",
    organizationId: "team-org",
    name: "team-server",
    icon: "🧪",
  };
  const me = {
    ...demoMe,
    user: { ...demoMe.user, id: "e2e-user", name: "E2E User", email: "e2e@example.com" },
    session: { ...demoMe.session, id: "e2e-session" },
  };
  await page.route("https://github.com/*.png*", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const headers = {
      "access-control-allow-origin": request.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const json = (data: unknown, status = 200) => route.fulfill({ headers, status, json: data });
    if (path === "/api/auth/sign-in/email")
      return json({ user: me.user, token: "e2e-session-token" });
    if (path === "/api/v1/me")
      return json({ ...me, session: { ...me.session, activeOrganizationId: activeOrganization } });
    if (path === "/api/v1/mobile/capabilities") return json({}, 404);
    if (path === "/api/v1/organizations")
      return json({
        organizations: [
          {
            id: "e2e-org",
            name: "Personal",
            slug: "personal",
            logo: null,
            isPersonal: true,
            role: "owner",
            createdAt: me.user.createdAt,
          },
          {
            id: "team-org",
            name: "Hologram team",
            slug: "hologram",
            logo: null,
            isPersonal: false,
            role: "admin",
            createdAt: me.user.createdAt,
          },
        ],
      });
    if (path === "/api/auth/organization/set-active") {
      if (rejectSwitch) {
        rejectSwitch = false;
        return json({ message: "Switch temporarily unavailable" }, 503);
      }
      activeOrganization = request.postDataJSON().organizationId;
      return json({});
    }
    if (path === "/api/v1/machines")
      return json({
        machines:
          activeOrganization === "team-org"
            ? [teamMachine]
            : [
                machine,
                {
                  ...machine,
                  id: "provisioning",
                  name: "Provisioning machine",
                  status: "provisioning",
                  hostname: null,
                },
                {
                  ...machine,
                  id: "offline",
                  name: "Offline machine",
                  agentSeenAt: new Date(Date.now() - 120000).toISOString(),
                },
              ],
      });
    if (
      path === "/api/v1/machines/second-machine" ||
      path === "/api/v1/machines/second-machine/icon"
    ) {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        if (path.endsWith("/icon")) {
          if (rejectIcon) {
            rejectIcon = false;
            return json({ message: "Icon save failed" }, 503);
          }
          machine.icon = body.icon;
        } else machine.name = body.name;
      }
      return json({ machine });
    }
    if (path.startsWith("/api/v1/github/")) {
      if (request.method() === "DELETE") {
        connected = false;
        return route.fulfill({ status: 204, headers });
      }
      if (path.endsWith("/connect"))
        return json({ url: "https://github.com/login/oauth/authorize?state=mobile-test" });
      if (path.endsWith("/accounts")) {
        accountsReads++;
        return json({ accounts: [{ id: 123, login: "hologram" }], nextPage: null });
      }
      if (path.endsWith("/repositories")) {
        reposReads++;
        return json({
          repositories: [
            {
              id: 99,
              fullName: "hologram/private-app",
              description: "Private app",
              private: true,
              defaultBranch: "main",
              url: "https://github.com/hologram/private-app.git",
            },
          ],
          nextPage: null,
        });
      }
      if (path.endsWith("/prepare")) {
        preparations.push({ path, body: request.postDataJSON() });
        // Stop before a real clone/network access; verify the correct managed ID and error surface.
        return json(
          { message: "GitHub access is still being configured on this VPS. Please retry shortly." },
          503,
        );
      }
      githubReads++;
      return json({
        configured: true,
        connected,
        login: connected ? "mobile-tester" : null,
        updatedAt: connected ? "2026-09-13T00:00:00Z" : null,
        manageUrl: "https://github.com/apps/concors-test/installations/new",
      });
    }
    return route.fallback();
  });
  return {
    failSwitch: () => {
      rejectSwitch = true;
    },
    failIcon: () => {
      rejectIcon = true;
    },
    setConnected: () => {
      connected = true;
    },
    counts: () => ({ githubReads, accountsReads, reposReads }),
    preparations,
  };
}
async function enter(page: Page) {
  await page.goto("http://localhost:8088");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("e2e@example.com");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const ui = uiFor(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
  await expect(
    ui.getByRole("option", { name: /Provisioning machine Provisioning/ }),
  ).toBeDisabled();
  await expect(ui.getByRole("option", { name: /Offline machine Offline/ })).toBeDisabled();
  await ui.getByRole("option", { name: /build-server Online/ }).click();
  await expect(ui.getByRole("button", { name: "Open workspace menu", exact: true })).toBeEnabled();
  return ui;
}
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("beta sign-in stays interactive and diagnostics reports the phone's backend and build", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await pending;
    await route.fallback();
  });
  try {
    await page.goto("http://localhost:8088");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("e2e@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Checking session…", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(
      "e2e@example.com",
    );
    await expect(page.getByRole("progressbar", { name: "Opening Concors" })).toHaveCount(0);
  } finally {
    release();
  }
  const ui = uiFor(page);
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const profile = await account(ui);
  await profile.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = sheet(ui, "Settings");
  await settings.getByRole("combobox", { name: "Settings section" }).click();
  await ui.locator('[role="option"][data-value="advanced"]').click();
  await expect(settings).toContainText("https://control-plane.example");
  await expect(settings).toContainText("Build number");
  await expect(settings).toContainText("Development / browser preview");
  await expect(settings).not.toContainText("http://localhost:3000");
  expect(errors).toEqual([]);
});

test("mobile sidebar reuses account avatars and edits machine names and icons through drawers", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const mock = await fixture(page);
  const ui = await enter(page);
  await expect(ui.getByRole("heading", { name: "Workspaces", exact: true })).toBeVisible();
  await expect(ui.locator("#mobile-sidebar").getByRole("button", { name: /sidebar/i })).toHaveCount(
    0,
  );
  await expect(ui.getByRole("combobox", { name: "Machine", exact: true })).toContainText("🚀");
  const profile = await account(ui);
  await expect(profile.locator("[data-account-avatar] img")).toHaveAttribute(
    "src",
    "https://github.com/mobile-tester.png?size=96",
  );
  expect(mock.counts()).toEqual({ githubReads: 1, accountsReads: 0, reposReads: 0 });
  await expect(profile.getByRole("button", { name: /Manage machines|Add machine/ })).toHaveCount(0);
  await profile.getByRole("button", { name: "Settings", exact: true }).click();
  await sheet(ui, "Settings").getByRole("combobox", { name: "Settings section" }).click();
  await expect(ui.getByRole("option", { name: "Machines", exact: true })).toHaveCount(1);
  await ui.getByRole("option", { name: "Machines", exact: true }).click();
  const row = ui.locator('[data-machine-id="second-machine"]');
  await row.getByRole("button", { name: "Rename build-server", exact: true }).click();
  await expect(sheet(ui, "Rename machine")).toHaveAttribute("data-mobile-drawer", "true");
  await sheet(ui, "Rename machine")
    .getByRole("textbox", { name: "Machine name", exact: true })
    .fill("renamed-server");
  await sheet(ui, "Rename machine").getByRole("button", { name: "Save name", exact: true }).click();
  await expect(row).toContainText("renamed-server");
  await row.getByRole("button", { name: "Change icon for renamed-server", exact: true }).click();
  await expect(sheet(ui, "Machine icon")).toHaveAttribute("data-mobile-drawer", "true");
  await sheet(ui, "Machine icon").getByRole("button", { name: "Testing", exact: true }).click();
  mock.failIcon();
  await sheet(ui, "Machine icon").getByRole("button", { name: "Save icon", exact: true }).click();
  await expect(sheet(ui, "Machine icon").getByRole("alert")).toContainText("Icon save failed");
  await sheet(ui, "Machine icon").getByRole("button", { name: "Save icon", exact: true }).click();
  await expect(row).toContainText("🧪");
  await close(ui, "Settings");
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(ui.getByRole("combobox", { name: "Machine", exact: true })).toContainText(
    "renamed-server",
  );
  await expect(ui.getByRole("combobox", { name: "Machine", exact: true })).toContainText("🧪");
  await page.screenshot({ path: "apps/mobile/test-results/managed/sidebar-sync.png" });
  expect(
    await ui.locator("body").evaluate(() => document.documentElement.scrollWidth > innerWidth),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("organization drawer preserves a failed switch and isolates machine lists and selection on success", async ({
  page,
}) => {
  const mock = await fixture(page);
  const ui = await enter(page);
  const profile = await account(ui);
  await profile.getByRole("combobox", { name: "Organization", exact: true }).click();
  await expect(sheet(ui, "Organization")).toHaveAttribute("data-mobile-drawer", "true");
  mock.failSwitch();
  await ui.getByRole("option", { name: /Hologram team Team · admin/ }).click();
  await expect(profile.getByRole("alert")).toContainText("Switch temporarily unavailable");
  await expect(profile.getByRole("combobox", { name: "Organization", exact: true })).toContainText(
    "Personal",
  );
  // Machine selection lives in the sidebar; account now only contains organization/settings.
  await close(ui, "Account");
  await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
  await expect(ui.getByRole("option", { name: /build-server Connected/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await close(ui, "Machine");
  await account(ui);
  await profile.getByRole("combobox", { name: "Organization", exact: true }).click();
  await ui.getByRole("option", { name: /Hologram team Team · admin/ }).click();
  await expect(sheet(ui, "Account")).toHaveCount(0);
  // Switching organizations retains isolation without an extra onboarding prompt.
  await expect(page.getByRole("button", { name: "Allow AI data sharing" })).toHaveCount(0);
  await expect(ui.getByRole("button", { name: "Open sidebar", exact: true })).toBeVisible();
  await account(ui);
  await expect(profile.getByRole("combobox", { name: "Organization", exact: true })).toContainText(
    "Hologram team",
  );
  await close(ui, "Account");
  await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
  await expect(ui.getByRole("option", { name: /team-server/ })).toBeVisible();
  await expect(ui.getByRole("option", { name: /build-server/ })).toHaveCount(0);
  await close(ui, "Machine");
  await account(ui);
  await profile.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = sheet(ui, "Settings");
  await settings.getByRole("combobox", { name: "Organization", exact: true }).click();
  await ui.getByRole("option", { name: /Personal Personal · owner/ }).click();
  await expect(settings).toHaveCount(0);
  await expect(ui.getByRole("button", { name: "Open sidebar", exact: true })).toBeVisible();
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
  await expect(ui.getByRole("option", { name: /build-server Connected/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("mobile GitHub account settings and repository picker use the selected managed machine", async ({
  page,
}) => {
  const mock = await fixture(page);
  const ui = await enter(page);
  const profile = await account(ui);
  await profile.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(sheet(ui, "Settings").getByText("Connected across your VPSs.")).toBeVisible();
  await sheet(ui, "Settings").getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(ui.locator("[data-account-avatar] img")).toHaveCount(0);
  const prompts: string[] = [];
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    void dialog.dismiss();
  });
  await sheet(ui, "Settings").getByRole("button", { name: "Connect GitHub", exact: true }).click();
  await expect
    .poll(() => prompts)
    .toContain("Open external link?\nhttps://github.com/login/oauth/authorize?state=mobile-test");
  mock.setConnected();
  // Native resumes forward this event after returning from the system browser.
  await ui.locator("body").evaluate(() => window.dispatchEvent(new Event("concors-foreground")));
  await expect(sheet(ui, "Settings").locator("[data-account-avatar] img")).toHaveCount(1);
  await close(ui, "Settings");
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: "Open workspace menu", exact: true }).click();
  await sheet(ui, "Open workspace")
    .getByRole("button", { name: "Clone repository…", exact: true })
    .click();
  const clone = sheet(ui, "Clone repository");
  await expect(clone.getByText("hologram/private-app", { exact: true })).toBeVisible();
  await clone.getByText("hologram/private-app", { exact: true }).click();
  await clone.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    clone.getByText("Cloning on this computer uses its local Git credentials."),
  ).toHaveCount(0);
  await clone.getByRole("button", { name: "Clone repository", exact: true }).click();
  await expect(clone.getByRole("alert")).toContainText("GitHub access is still being configured");
  expect(mock.preparations).toEqual([
    {
      path: "/api/v1/github/machines/second-machine/prepare",
      body: { repository: "hologram/private-app" },
    },
  ]);
  expect(mock.counts().reposReads).toBe(1);
  await page.screenshot({ path: "apps/mobile/test-results/managed/clone-sync.png" });
  expect(
    await ui.locator("body").evaluate(() => document.documentElement.scrollWidth > innerWidth),
  ).toBe(false);
});
