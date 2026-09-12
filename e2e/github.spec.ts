import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, extname, join } from "node:path";
import { signedIn } from "./signed-in.ts";
import { managedHost } from "./support/managed-host.ts";

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
    await dialog.getByRole("button", { name: "Add account or organization", exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      dialog
        .getByRole("combobox", { name: "GitHub account" })
        .getByRole("option", { name: "another-org" }),
    ).toHaveCount(1);
    await dialog.getByRole("combobox", { name: "GitHub account" }).selectOption("2");
    await dialog.getByRole("textbox", { name: "Search repositories" }).fill("private");
    await dialog.getByRole("button", { name: /acme\/private-service/ }).click();
    await expect(dialog.getByRole("textbox", { name: "Selected repository" })).toHaveValue(
      "https://github.com/acme/private-service.git",
    );
    await expect(dialog.getByRole("textbox", { name: "Destination folder" })).toHaveValue(
      "~/repos/private-service",
    );
    await page.screenshot({ path: "test-results/github-repository-picker.png" });
    await dialog.getByRole("button", { name: "Clone repository", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("still being configured");
    expect(github.preparations).toEqual([
      {
        path: "/api/v1/github/machines/second-machine/prepare",
        body: { repository: "acme/private-service" },
      },
    ]);
    await dialog.getByRole("button", { name: "Paste a URL" }).click();
    await expect(
      dialog.getByRole("textbox", { name: "Repository URL or local path" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 650, height: 800 });
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: "test-results/github-repository-narrow.png" });
    github.setReady();
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
