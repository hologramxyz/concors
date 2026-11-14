import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

/** Which folders the fixture CLIs say they were used in; empty again after each test. */
async function recentFolders(folders: Record<string, { directory: string; updatedAt: string }[]>) {
  const response = await fetch("http://127.0.0.1:7429/e2e/recent-folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(folders),
  });
  expect(response.ok).toBe(true);
}

const setup = (page: Page) => page.getByRole("dialog", { name: "Set up Concors" });
const step = (page: Page, title: string) =>
  expect(setup(page).getByRole("heading", { level: 2, name: title })).toBeVisible();
const primary = (page: Page) => setup(page).locator("[data-setup-primary]");

test.afterEach(() => recentFolders({}));

test("a new user is walked from nothing to a first agent at work", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const project = await mkdtemp(join(tmpdir(), "concors-setup-"));
  await recentFolders({
    codex: [{ directory: project, updatedAt: new Date(Date.now() - 3_600_000).toISOString() }],
  });
  try {
    await signedIn(page, undefined, undefined, { freshSetup: true });
    await page.goto("/");

    // 1. Where agents run: this computer, without buying anything.
    await step(page, "Where should your agents run?");
    await expect(
      setup(page).getByRole("radio", { name: /A Concors cloud machine/ }),
    ).toHaveAttribute("aria-checked", "true");
    await setup(page)
      .getByRole("radio", { name: /This computer/ })
      .click();
    await page.screenshot({ path: testInfo.outputPath("1-where.png") });
    await primary(page).click();

    // 2. Agents: Codex is installed on the fixture machine and signs in from here.
    await step(page, "Your agents");
    const codex = setup(page).getByRole("listitem", { name: "Codex" });
    await expect(codex).toHaveAttribute("data-agent-readiness", /ready|sign-in/);
    if ((await codex.getAttribute("data-agent-readiness")) === "sign-in") {
      await codex.getByRole("button", { name: "Sign in" }).click();
      // The same sign-in as Settings and the model menu, over setup; the fixture connects itself.
      const signIn = page.getByRole("dialog", { name: "Sign in to ChatGPT" });
      await expect(signIn).toContainText("Connected", { timeout: 15_000 });
      await page.keyboard.press("Escape");
      await expect(signIn).toHaveCount(0);
      await expect(codex).toHaveAttribute("data-agent-readiness", "ready");
    }
    await expect(primary(page)).toHaveText("Continue");
    await page.screenshot({ path: testInfo.outputPath("2-agents.png") });
    await primary(page).click();

    // 3. Projects: the folder Codex was used in is offered, ticked, and added.
    await step(page, "Add your first project");
    const suggestion = setup(page).getByRole("checkbox", { name: new RegExp(project) });
    await expect(suggestion).toBeChecked();
    await expect(primary(page)).toHaveText("Add 1 project");
    await page.screenshot({ path: testInfo.outputPath("3-project.png") });
    await primary(page).click();
    await expect(setup(page).getByText("Added")).toBeVisible();
    await expect(primary(page)).toHaveText("Continue");
    await primary(page).click();

    // 4. Phone.
    await step(page, "Take your agents with you");
    await expect(setup(page).getByRole("img", { name: /QR code/ })).toBeVisible();
    await primary(page).click();

    // 5. The first task goes to the new workspace's chat, and setup closes on it.
    await step(page, "Give your first agent a task");
    await expect(setup(page).getByRole("button", { name: "Agent and model" })).toBeVisible({
      timeout: 15_000,
    });
    await setup(page)
      .getByRole("button", { name: "Explain how this project is organised" })
      .click();
    await expect(setup(page).getByRole("textbox", { name: "First task" })).toHaveValue(
      "Explain how this project is organised",
    );
    await page.screenshot({ path: testInfo.outputPath("5-first-agent.png") });
    await primary(page).click();
    await expect(setup(page)).toHaveCount(0);
    // The chat setup closed on shows the task and the agent's answer, in the workspace's own
    // first chat rather than a second one.
    await expect(page.getByText("New chat", { exact: true })).toHaveCount(0);
    const chat = page.getByRole("log").filter({ visible: true, hasText: "Hello from Codex" });
    await expect(chat).toContainText("Explain how this project is organised");
    await page.screenshot({ path: testInfo.outputPath("6-chat.png") });

    // Finished is remembered: a reload goes straight to work.
    await page.reload();
    await expect(chat).toContainText("Explain how this project is organised");
    await expect(setup(page)).toHaveCount(0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("setup can be skipped, comes back from the account menu, and leaves existing users alone", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-setup-skip-"));
  try {
    await signedIn(page, undefined, undefined, { freshSetup: true });
    await page.goto("/");
    await step(page, "Where should your agents run?");
    await setup(page).getByRole("button", { name: "Skip setup" }).click();
    await expect(setup(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(setup(page)).toHaveCount(0);

    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Set up Concors" }).click();
    await step(page, "Where should your agents run?");
    // Escape and clicks outside leave it open: leaving is Skip setup.
    await page.keyboard.press("Escape");
    await expect(setup(page)).toBeVisible();
    await setup(page).getByRole("button", { name: "Skip setup" }).click();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("someone who already has workspaces is not stopped by setup", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-setup-existing-"));
  try {
    await signedIn(page, undefined, undefined, { freshSetup: true });
    await page.goto("/");
    await step(page, "Where should your agents run?");
    await setup(page).getByRole("button", { name: "Skip setup" }).click();
    await seedProject(page, "Existing work", directory);
    // A new device for someone who already works in Concors.
    await page.evaluate(() => localStorage.removeItem("concors.setup.v1"));
    await page.reload();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByText("Existing work"),
    ).toBeVisible();
    await expect(setup(page)).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a guest who picks the cloud signs in, and setup waits for them", async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 401, json: { message: "Authentication required" } }),
  );
  await page.goto("/");
  await step(page, "Where should your agents run?");
  await expect(setup(page)).toContainText("Buying a cloud machine needs an account");
  await expect(primary(page)).toHaveText("Sign in to continue");
  await primary(page).click();
  await expect(page.getByRole("heading", { name: "Sign in to Concors" })).toBeVisible();
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem("concors.setup.v1"))) ?? "{}"),
  ).toMatchObject({ status: "open", step: 0 });
  // Back without signing in: setup is where it was, and this computer needs no account.
  await page.getByRole("button", { name: "Not now" }).click();
  await step(page, "Where should your agents run?");
  await setup(page)
    .getByRole("radio", { name: /This computer/ })
    .click();
  await expect(primary(page)).toHaveText("Continue");
});
