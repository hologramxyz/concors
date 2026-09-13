import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, extname, join } from "node:path";
import { signedIn } from "./signed-in.ts";
import { managedHost } from "./support/managed-host.ts";

// Keep avatar loads deterministic and avoid contacting GitHub in browser acceptance.
test.beforeEach(async ({ page }) => {
  await page.route("https://github.com/*.png*", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
});

// The focused config serves built assets through Playwright; the general suite uses its normal Vite fixture.
test.beforeEach(async ({ page, baseURL }) => {
  if (baseURL !== "http://localhost:15399") return;
  await page.route("http://localhost:15399/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) return route.fallback();
    const file = url.pathname.startsWith("/assets/") ? url.pathname.slice(1) : "index.html";
    const types: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    };
    await route.fulfill({
      body: await readFile(resolve("apps/desktop/dist", file)),
      contentType: types[extname(file)] ?? "application/octet-stream",
    });
  });
});

async function githubApi(page: Page, initiallyConnected = true) {
  let connected = initiallyConnected;
  let ready = false;
  let accounts = [
    { id: 1, login: "alice" },
    { id: 2, login: "acme" },
  ];
  const preparations: unknown[] = [];
  await page.route("**/api/v1/github/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      "access-control-allow-origin": request.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.method() === "DELETE") {
      connected = false;
      return route.fulfill({ status: 204, headers });
    }
    if (url.pathname.endsWith("/prepare")) {
      preparations.push({ path: url.pathname, body: request.postDataJSON() });
      if (ready) return route.fulfill({ headers, json: { ready: true } });
      // Block before Git starts: this is an API/UI test, not a real clone or VPS provisioning.
      return route.fulfill({
        status: 503,
        headers,
        json: {
          message: "GitHub access is still being configured on this VPS. Please retry shortly.",
          error: "Service Unavailable",
          statusCode: 503,
        },
      });
    }
    const fullName =
      url.searchParams.get("installationId") === "2" ? "acme/private-service" : "alice/project";
    const response = url.pathname.endsWith("/connect")
      ? { url: "https://github.com/login/oauth/authorize?state=test-only" }
      : url.pathname.endsWith("/accounts")
        ? {
            // Exercise pagination even with a small fixture.
            accounts: accounts.slice(
              Number(url.searchParams.get("page") ?? 1) - 1,
              Number(url.searchParams.get("page") ?? 1),
            ),
            nextPage:
              Number(url.searchParams.get("page") ?? 1) < accounts.length
                ? Number(url.searchParams.get("page") ?? 1) + 1
                : null,
          }
        : url.pathname.endsWith("/repositories")
          ? {
              repositories: [
                {
                  id: 12,
                  fullName,
                  description: "A private development project",
                  private: true,
                  defaultBranch: "main",
                  url: `https://github.com/${fullName}.git`,
                },
              ],
              nextPage: null,
            }
          : {
              configured: true,
              connected,
              login: connected ? "alice" : null,
              updatedAt: connected ? "2026-09-12T00:00:00Z" : null,
              manageUrl: "https://github.com/apps/concors-test/installations/new",
            };
    return route.fulfill({ headers, json: response });
  });
  return {
    preparations,
    setConnected: () => {
      connected = true;
    },
    setAccounts: (value: { id: number; login: string }[]) => {
      accounts = value;
    },
    setReady: () => {
      ready = true;
    },
  };
}

test("account settings connects and disconnects GitHub without exposing credentials", async ({
  page,
}) => {
  await signedIn(page);
  await githubApi(page, false);
  const opened: string[] = [];
  await page.exposeFunction("recordGitHubOpen", (url: string) => opened.push(url));
  await page.addInitScript(() => {
    window.open = (url) => {
      void (
        window as unknown as { recordGitHubOpen: (url: string) => Promise<void> }
      ).recordGitHubOpen(String(url));
      return null;
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Connect GitHub", exact: true }).click();
  await expect(page.getByRole("link", { name: "Continue on GitHub" })).toBeVisible();
  expect(opened).toEqual(["https://github.com/login/oauth/authorize?state=test-only"]);
  await githubApi(page);
  await page.getByRole("button", { name: "Refresh GitHub" }).click();
  await expect(page.getByText("Connected across your VPSs.")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect GitHub", exact: true })).toBeVisible();
});

test("GitHub setup discovers newly granted organizations automatically on return", async ({
  page,
}) => {
  await signedIn(page);
  const github = await githubApi(page, false);
  github.setAccounts([]);
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Connect GitHub", exact: true }).click();
  github.setConnected();
  // OAuth finishes before installation. Keep guiding to repository access rather than
  // treating the new user token as the end of onboarding (or reusing the spent OAuth URL).
  await expect(
    page.getByText(
      "GitHub connected. Choose an account or organization to access its repositories.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/apps/concors-test/installations/new",
  );
  github.setAccounts([
    { id: 1, login: "alice" },
    { id: 2, login: "acme" },
    { id: 3, login: "another-org" },
  ]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const access = page.getByLabel("Accounts with repository access");
  await expect(access.getByText("acme", { exact: true })).toBeVisible();
  await expect(access.getByText("another-org", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue on GitHub" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add account or organization", exact: true }).click();
  await expect(page.getByRole("link", { name: "Continue on GitHub" })).toBeVisible();
  github.setAccounts([{ id: 1, login: "alice" }]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(access.getByText("acme", { exact: true })).toHaveCount(0);
  await expect(access.getByText("alice", { exact: true })).toBeVisible();
});

test("repository picker switches personal and organization repos and prepares the selected VPS", async ({
  page,
}) => {
  await signedIn(page);
  await managedHost(page);
  await page.addInitScript(() => {
    window.open = () => null;
  });
  const directory = await mkdtemp(join(tmpdir(), "github-clone-browser-"));
  const source = join(directory, "source");
  execFileSync("git", ["init", source], { stdio: "ignore" });
  await writeFile(join(source, "README.md"), "GitHub clone fixture\n");
  execFileSync("git", ["-C", source, "add", "README.md"]);
  execFileSync(
    "git",
    [
      "-C",
      source,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "-m",
      "fixture",
    ],
    { stdio: "ignore" },
  );
  const cloneUrls: string[] = [];
  await page.routeWebSocket("wss://second.example/ws", (client) => {
    const server = new WebSocket("ws://127.0.0.1:7430/ws");
    const pending: string[] = [];
    client.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "project.request" && message.operation.kind === "start") {
        cloneUrls.push(message.operation.repository);
        // Exercise the real daemon clone/workspace flow using an isolated local Git fixture.
        message.operation.repository = source;
      }
      const text = JSON.stringify(message);
      if (server.readyState === WebSocket.OPEN) server.send(text);
      else pending.push(text);
    });
    server.addEventListener("open", () => {
      for (const message of pending) server.send(message);
    });
    server.addEventListener("message", (event) => client.send(String(event.data)));
    server.addEventListener("close", () => client.close());
    client.onClose(() => server.close());
  });
  try {
    const github = await githubApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Switch machine" }).click();
    await page.getByRole("menuitem", { name: /Second machine/ }).click();
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Clone repository…", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: /alice\/project/ })).toBeVisible();
    github.setAccounts([
      { id: 1, login: "alice" },
      { id: 2, login: "acme" },
      { id: 3, login: "another-org" },
    ]);
    await dialog.getByRole("button", { name: "Add account", exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      dialog
        .getByRole("combobox", { name: "GitHub account" })
        .getByRole("option", { name: "another-org" }),
    ).toHaveCount(1);
    await dialog.getByRole("combobox", { name: "GitHub account" }).selectOption("2");
    await dialog.getByRole("textbox", { name: "Search repositories" }).fill("private");
    await dialog.getByRole("button", { name: /acme\/private-service/ }).click();
    await expect(dialog.getByRole("textbox", { name: "Selected repository" })).toHaveCount(0);
    await expect(dialog.getByRole("textbox", { name: "Destination folder" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/github-repository-picker.png" });
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Destination folder" })).toHaveValue(
      "~/repos/private-service",
    );
    await page.screenshot({ path: "test-results/github-clone-destination.png" });
    await dialog.getByRole("button", { name: "Clone repository", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("still being configured");
    expect(github.preparations).toEqual([
      {
        path: "/api/v1/github/machines/second-machine/prepare",
        body: { repository: "acme/private-service" },
      },
    ]);
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Search repositories" })).toHaveValue(
      "private",
    );
    await dialog.getByRole("button", { name: "Paste a URL" }).click();
    await expect(
      dialog.getByRole("textbox", { name: "Repository URL or local path" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 650, height: 800 });
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: "test-results/github-repository-narrow.png" });
    github.setReady();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog
      .getByRole("textbox", { name: "Destination folder" })
      .fill(join(directory, "cloned"));
    await dialog.getByRole("button", { name: "Clone repository", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(cloneUrls).toEqual(["https://github.com/acme/private-service.git"]);
    expect(await readFile(join(directory, "cloned", "README.md"), "utf8")).toBe(
      "GitHub clone fixture\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("clone dialog keeps its layout, rows and selection through focus and slow or failed refreshes", async ({
  page,
}) => {
  await signedIn(page);
  await managedHost(page);
  await githubApi(page);
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  let release!: () => void;
  let gate: Promise<void> | null = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = false;
  let requests = 0;
  await page.route("**/api/v1/github/**", async (route) => {
    requests++;
    if (gate) await gate;
    if (fail && new URL(route.request().url()).pathname.endsWith("/repositories")) {
      return route.fulfill({
        status: 503,
        headers: {
          "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
          "access-control-allow-credentials": "true",
        },
        json: {
          message: "GitHub is temporarily unavailable.",
          error: "Service Unavailable",
          statusCode: 503,
        },
      });
    }
    return route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine" }).click();
  await page.getByRole("menuitem", { name: /Second machine/ }).click();
  await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Clone repository…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("status", { name: "Loading repositories", exact: true }),
  ).toBeVisible();
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const bounds = await dialog.boundingBox();
  const footer = await dialog.getByRole("button", { name: "Continue", exact: true }).boundingBox();
  await page.screenshot({ path: "test-results/clone-loading.png" });
  release();
  gate = null;
  const repository = dialog.getByRole("button", { name: /alice\/project/ });
  await expect(repository).toBeVisible();
  expect(await dialog.boundingBox()).toEqual(bounds);
  expect(await dialog.getByRole("button", { name: "Continue", exact: true }).boundingBox()).toEqual(
    footer,
  );
  await repository.click();
  const beforeFocus = requests;
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("focus"));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  expect(requests).toBe(beforeFocus);
  await expect(repository).toHaveAttribute("aria-pressed", "true");
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fail = true;
  await dialog.getByRole("button", { name: "Refresh GitHub" }).click();
  await expect(repository).toBeVisible();
  expect(await dialog.boundingBox()).toEqual(bounds);
  release();
  gate = null;
  await expect(dialog.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(repository).toBeVisible();
  await expect(repository).toHaveAttribute("aria-pressed", "true");
  expect(await dialog.boundingBox()).toEqual(bounds);
  fail = false;
  await dialog.getByRole("button", { name: "Refresh GitHub" }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: "test-results/clone-repositories.png" });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Destination folder" })).toHaveValue(
    "~/repos/project",
  );
  await expect(dialog.getByRole("textbox", { name: "Destination folder" })).toBeFocused();
  const beforeBack = requests;
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(repository).toHaveAttribute("aria-pressed", "true");
  expect(requests).toBe(beforeBack);
  await page.setViewportSize({ width: 390, height: 700 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeInViewport();
  await page.screenshot({ path: "test-results/clone-narrow.png" });
});

test("reopening the clone dialog reuses GitHub accounts and repositories", async ({ page }) => {
  await signedIn(page);
  await managedHost(page);
  await githubApi(page);
  let reads = 0;
  await page.route("**/api/v1/github/**", async (route) => {
    if (route.request().method() === "GET") reads++;
    return route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine" }).click();
  await page.getByRole("menuitem", { name: /Second machine/ }).click();
  const open = async () => {
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Clone repository…", exact: true }).click();
  };
  await open();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /alice\/project/ })).toBeVisible();
  const before = reads;
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await open();
  await expect(dialog.getByRole("button", { name: /alice\/project/ })).toBeVisible();
  await expect(
    dialog.getByRole("status", { name: "Loading repositories", exact: true }),
  ).toHaveCount(0);
  expect(reads).toBe(before);
  // Revisiting an installation is also immediate and does not re-fetch its list.
  const accounts = dialog.getByRole("combobox", { name: "GitHub account" });
  await accounts.selectOption("2");
  await expect(dialog.getByRole("button", { name: /acme\/private-service/ })).toBeVisible();
  const afterSecond = reads;
  await accounts.selectOption("1");
  await expect(dialog.getByRole("button", { name: /alice\/project/ })).toBeVisible();
  expect(reads).toBe(afterSecond);
});

test("repository access rejection removes cached rows instead of treating them as available", async ({
  page,
}) => {
  await signedIn(page);
  await managedHost(page);
  await githubApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Switch machine" }).click();
  await page.getByRole("menuitem", { name: /Second machine/ }).click();
  await page.getByRole("button", { name: "Open workspace menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Clone repository…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const repository = dialog.getByRole("button", { name: /alice\/project/ });
  await expect(repository).toBeVisible();
  await repository.click();
  await page.route("**/api/v1/github/**/repositories**", (route) => {
    if (route.request().method() === "OPTIONS") return route.fallback();
    return route.fulfill({
      status: 403,
      headers: {
        "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
        "access-control-allow-credentials": "true",
      },
      json: { message: "Repository access revoked", error: "Forbidden", statusCode: 403 },
    });
  });
  await dialog.getByRole("button", { name: "Refresh GitHub" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Repository access revoked");
  await expect(repository).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
});

test("GitHub avatar is shared by the sidebar, rail and settings without loading repositories", async ({
  page,
}) => {
  await signedIn(page);
  await githubApi(page);
  const reads: string[] = [];
  await page.route("**/api/v1/github/**", (route) => {
    if (route.request().method() === "GET") reads.push(new URL(route.request().url()).pathname);
    return route.fallback();
  });
  await page.goto("/");
  const account = page.getByRole("button", { name: /^Account:/ });
  const avatar = account.locator("[data-account-avatar] img");
  await expect(avatar).toHaveAttribute("src", "https://github.com/alice.png?size=96");
  await expect
    .poll(() => avatar.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(reads).toEqual(["/api/v1/github/"]);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(avatar).toBeVisible();
  await account.click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const profile = page.locator("[data-account-avatar] img");
  await expect(profile).toHaveAttribute("src", "https://github.com/alice.png?size=96");
  await expect(page.getByText("Connected across your VPSs.")).toBeVisible();
  expect(reads.filter((path) => path === "/api/v1/github/")).toHaveLength(1);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.locator("[data-account-avatar]")).toHaveText("E");
  await expect(profile).toHaveCount(0);
  await page.getByRole("button", { name: "Back to app" }).click();
  await expect(account.locator("[data-account-avatar]")).toHaveText("E");
  await expect(avatar).toHaveCount(0);
});

test("connecting GitHub updates the profile and sidebar avatar without a reload", async ({
  page,
}) => {
  await signedIn(page);
  const github = await githubApi(page, false);
  await page.goto("/");
  const account = page.getByRole("button", { name: /^Account:/ });
  await expect(account.locator("[data-account-avatar]")).toHaveText("E");
  await account.click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect GitHub", exact: true })).toBeVisible();
  github.setConnected();
  await page.getByRole("button", { name: "Refresh GitHub" }).click();
  await expect(page.locator("[data-account-avatar] img")).toHaveAttribute(
    "src",
    "https://github.com/alice.png?size=96",
  );
  await page.getByRole("button", { name: "Back to app" }).click();
  await expect(account.locator("[data-account-avatar] img")).toHaveAttribute(
    "src",
    "https://github.com/alice.png?size=96",
  );
  await page.screenshot({ path: test.info().outputPath("github-avatar.png") });
});

test("slow identity checks reserve avatar space and failed images fall back to initials", async ({
  page,
}) => {
  await signedIn(page);
  await githubApi(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/github/", async (route) => {
    if (route.request().method() === "GET") await gate;
    return route.fallback();
  });
  await page.route("https://github.com/*.png*", (route) => route.abort());
  await page.goto("/");
  const avatar = page.getByRole("button", { name: /^Account:/ }).locator("[data-account-avatar]");
  await expect(avatar).toHaveAttribute("data-loading", "true");
  await expect(avatar).toHaveText("");
  const bounds = await avatar.boundingBox();
  release();
  await expect(avatar).toHaveText("E");
  expect(await avatar.boundingBox()).toEqual(bounds);
  await expect(avatar.locator("img")).toHaveCount(0);
});
