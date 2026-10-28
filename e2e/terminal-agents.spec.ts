import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { tab } from "./support/tabs.ts";
import type { Page } from "@playwright/test";

/**
 * A sidebar row for a terminal agent, by its status and the provider icon it shows. A shell that
 * runs an agent keeps its tab's name ("Terminal"), so the icon is what says which agent it is.
 */
const agentRow = (scope: Page, status: string, provider: string) =>
  scope
    .getByRole("button", { name: new RegExp(`Agent status: ${status}`) })
    .filter({ has: scope.locator(`[data-provider="${provider}"]`) });

test("Codex terminal profiles appear across clients and agent clicks focus the owning split pane", async ({
  page,
  browser,
}) => {
  // Two clients exercise both provider lifecycles with repeated page reloads.
  // Allow time for the complete flow and teardown; assertion deadlines stay at 5s.
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-terminal-agents-"));
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");
    await seedProject(page, "Terminal agents", directory);
    // Both clients' sidebars must receive the same live terminal activity.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const agents = page.getByRole("navigation", { name: "Primary" });
    await expect(agents.getByRole("button", { name: /Open in terminal/ })).toHaveCount(0);
    // Starting an agent from a normal shell must be discovered without changing its profile.
    const shellPane = page.getByRole("region", { name: "Terminal pane", exact: true });
    await expect(shellPane.getByLabel("Terminal output").filter({ visible: true })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const shellPaneId = await shellPane.getAttribute("data-pane-id");
    // Attached is not started: until the shell is running the terminal takes no input, and on a
    // busy runner keys typed before its prompt appeared were lost. Type once it prompts.
    await expect(shellPane.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "$",
    );
    await shellPane.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("codex");
    await page.keyboard.press("Enter");
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(1);
    await expect(agents.locator('[data-provider="codex"]')).toBeVisible();
    await expect(shellPane.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "CODEX_TERMINAL_READY",
    );
    await second.goto(test.info().project.use.baseURL ?? "http://localhost:1420");
    // The shell's tab keeps its name; the row shows the Codex running in it by its icon.
    const shellAgent = second
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: /Open in terminal/ })
      .filter({ has: second.locator('[data-provider="codex"]') });
    await expect(shellAgent).toBeVisible();
    await second.reload();
    await shellAgent.click();
    await expect
      .poll(() =>
        second.evaluate(() =>
          document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
        ),
      )
      .toBe(shellPaneId);
    await second.keyboard.type("test-working");
    await second.keyboard.press("Enter");
    await expect(
      agents.getByRole("button", { name: /Agent status: Working.*Codex/ }),
    ).toBeVisible();
    await expect(agentRow(second, "Working", "codex")).toBeVisible();
    await second.keyboard.type("test-approval");
    await second.keyboard.press("Enter");
    await expect(
      agents.getByRole("button", { name: /Agent status: Needs input.*Codex/ }),
    ).toBeVisible();
    await second.keyboard.type("test-idle");
    await second.keyboard.press("Enter");
    for (const client of [page, second]) {
      const done = agentRow(client, "Done", "codex");
      await expect(done).toBeVisible();
      // Done and idle look alike in the sidebar: no dot.
      await expect(done.locator("[data-row-state]")).toHaveCount(0);
    }
    await expect(agents.getByRole("button", { name: /Agent status: Working.*Codex/ })).toHaveCount(
      0,
    );
    await second.keyboard.type("exit");
    await second.keyboard.press("Enter");
    await expect(shellAgent).toHaveCount(0);
    await expect(agents.getByRole("button", { name: /Open in terminal/ })).toHaveCount(0);

    // Claude redraws its screen without a title update. Both sidebars must follow
    // real working / permission / completed UI, including after observer reconnect.
    await second.keyboard.type("claude");
    await second.keyboard.press("Enter");
    const claude = agents.getByRole("button", { name: /Open in terminal.*Claude/ });
    await expect(claude).toBeVisible();
    await expect(agents.locator('[data-provider="claude"]')).toBeVisible();
    for (const [command, label] of [
      ["test-working", "Working"],
      ["test-approval", "Needs input"],
      ["test-idle", "Done"],
    ]) {
      await second.keyboard.type(command);
      await second.keyboard.press("Enter");
      for (const client of [page, second])
        await expect(agentRow(client, label, "claude")).toBeVisible();
    }
    await second.reload();
    const completedClaude = agentRow(second, "Done", "claude");
    await expect(completedClaude.locator("[data-row-state]")).toHaveCount(0);
    await completedClaude.click();
    await expect(second.getByLabel("Terminal output").filter({ visible: true })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await second.locator(".xterm-helper-textarea").focus();
    await second.keyboard.type("exit");
    await second.keyboard.press("Enter");
    await expect(claude).toHaveCount(0);

    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(1);
    await agents.getByRole("button", { name: /Open in terminal.*Codex/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("Codex");
    await page.mouse.move(0, 0);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "CODEX_TERMINAL_READY",
    );
    await expect(
      agents.getByLabel("Agent status: Open in terminal").locator(".animate-spin"),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally" }).click();
    await expect(
      page
        .getByRole("region", { name: "Codex pane", exact: true })
        .locator(".xterm")
        .filter({ visible: true }),
    ).toHaveCount(2);
    // The sidebar lists the split tab once, whatever runs in its panes.
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(1);
    const panes = page.getByRole("region", { name: "Codex pane", exact: true });
    const firstPaneId = await panes.first().getAttribute("data-pane-id");
    const lastPaneId = await panes.last().getAttribute("data-pane-id");
    await expect(
      panes.last().getByLabel("Terminal output").filter({ visible: true }),
    ).toContainText("CODEX_TERMINAL_READY");

    await second.goto(test.info().project.use.baseURL ?? "http://localhost:1420");
    // The expanded sidebar lists the split tab once, whatever runs in its panes.
    const remoteAgents = second.getByRole("navigation", { name: "Primary" });
    await expect(remoteAgents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(
      1,
    );
    await second.reload();
    await expect(remoteAgents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(
      1,
    );
    await second.getByRole("button", { name: /^Account:/ }).click();
    await second.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await second.getByRole("button", { name: "Back to app", exact: true }).click();

    await tab(page, 0).click();
    await agents.getByRole("button", { name: /Open in terminal.*Codex/ }).click();
    await expect(tab(page, 1)).toHaveAttribute("aria-pressed", "true");
    // The row opens its tab and focuses one of its panes; it names the tab, not a pane.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
        ),
      )
      .toMatch(new RegExp(`^(${firstPaneId}|${lastPaneId})$`));
    await panes.last().getByLabel("Terminal output").filter({ visible: true }).click();
    await page.keyboard.type("second-pane");
    await page.keyboard.press("Enter");
    await expect(
      panes.last().getByLabel("Terminal output").filter({ visible: true }),
    ).toContainText("CODEX_REPLY:second-pane");
    await expect(page.getByRole("complementary", { name: "Agent sessions" })).toHaveCount(0);

    await panes.first().locator(".xterm-helper-textarea").focus();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
        ),
      )
      .toBe(firstPaneId);
    await page.keyboard.type("fail");
    await page.keyboard.press("Enter");
    await expect(panes.first().getByRole("button", { name: "Start new session" })).toBeVisible();
    await expect(remoteAgents.getByRole("button", { name: /Failed.*Codex/ })).toHaveCount(0);
    await expect(remoteAgents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(
      1,
    );
    await remoteAgents.getByRole("button", { name: /Open in terminal.*Codex/ }).click();
    await expect(
      second.getByRole("heading", { name: "Terminal agents", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        second.evaluate(() =>
          document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
        ),
      )
      .toBe(lastPaneId);
    await second.keyboard.press("Control+c");
    await expect(panes.last().getByRole("button", { name: "Start new session" })).toBeVisible();
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(0);
    await expect(remoteAgents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(
      0,
    );
    await second.reload();
    await expect(
      remoteAgents.getByRole("button", {
        name: /(?:Open in terminal|Exited|Failed|Interrupted).*Codex/,
      }),
    ).toHaveCount(0);
    await panes.last().getByRole("button", { name: "Start new session" }).click();
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(1);
    await panes.last().getByRole("button", { name: "Close pane" }).click();
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(0);
    await expect(remoteAgents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(
      0,
    );
    await second.reload();
    await expect(remoteAgents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(
      0,
    );
    await page.screenshot({ path: "test-results/terminal-agents.png" });
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
