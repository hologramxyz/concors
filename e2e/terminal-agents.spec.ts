import { seedProject } from "./support/projects.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

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
    // The collapsed rail and full sidebar must receive the same live terminal activity.
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const agents = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("region", { name: "Agents", exact: true });
    await expect(agents.getByRole("button", { name: /Open in terminal/ })).toHaveCount(0);
    // Starting an agent from a normal shell must be discovered without changing its profile.
    const shellPane = page.getByRole("region", { name: "Terminal pane", exact: true });
    await expect(shellPane.getByLabel("Terminal output").filter({ visible: true })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const shellPaneId = await shellPane.getAttribute("data-pane-id");
    await shellPane.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("codex");
    await page.keyboard.press("Enter");
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(1);
    await expect(agents.locator('[data-provider="codex"]')).toBeVisible();
    await expect(shellPane.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "CODEX_TERMINAL_READY",
    );
    await second.goto(test.info().project.use.baseURL ?? "http://localhost:1420");
    const shellAgent = second
      .getByRole("navigation", { name: "Primary" })
      .getByRole("region", { name: "Agents", exact: true })
      .getByRole("button", { name: /Open in terminal.*Codex/ });
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
    await expect(
      second.getByRole("button", { name: /Agent status: Working.*Codex/ }),
    ).toBeVisible();
    await second.keyboard.type("test-approval");
    await second.keyboard.press("Enter");
    await expect(
      agents.getByRole("button", { name: /Agent status: Needs input.*Codex/ }),
    ).toBeVisible();
    await second.keyboard.type("test-idle");
    await second.keyboard.press("Enter");
    for (const client of [page, second]) {
      const done = client.getByRole("button", { name: /Agent status: Done.*Codex/ });
      await expect(done).toBeVisible();
      await expect(done.locator(".bg-emerald-500")).toBeVisible();
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
        await expect(
          client.getByRole("button", { name: new RegExp(`Agent status: ${label}.*Claude`) }),
        ).toBeVisible();
    }
    await second.reload();
    const completedClaude = second.getByRole("button", { name: /Agent status: Done.*Claude/ });
    await expect(completedClaude.locator(".bg-emerald-500")).toBeVisible();
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
    await expect(page.getByRole("tooltip")).toContainText("Terminal agents");
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
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(2);
    const panes = page.getByRole("region", { name: "Codex pane", exact: true });
    const firstPaneId = await panes.first().getAttribute("data-pane-id");
    const lastPaneId = await panes.last().getAttribute("data-pane-id");
    await expect(
      panes.last().getByLabel("Terminal output").filter({ visible: true }),
    ).toContainText("CODEX_TERMINAL_READY");

    await second.goto(test.info().project.use.baseURL ?? "http://localhost:1420");
    const remoteAgents = second
      .getByRole("navigation", { name: "Primary" })
      .getByRole("region", { name: "Agents", exact: true });
    await expect(remoteAgents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(
      2,
    );
    await second.reload();
    await expect(remoteAgents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(
      2,
    );
    await second.getByRole("button", { name: /^Account:/ }).click();
    await second.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await second.getByRole("button", { name: "Back to app", exact: true }).click();

    await page.getByRole("button", { name: "Tab 1", exact: true }).click();
    await agents
      .getByRole("button", { name: /Open in terminal.*Codex/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Tab 2", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
        ),
      )
      .toBe(lastPaneId);
    await page.keyboard.type("second-pane");
    await page.keyboard.press("Enter");
    await expect(
      panes.last().getByLabel("Terminal output").filter({ visible: true }),
    ).toContainText("CODEX_REPLY:second-pane");
    await expect(page.getByRole("complementary", { name: "Agent sessions" })).toHaveCount(0);

    await agents
      .getByRole("button", { name: /Open in terminal.*Codex/ })
      .last()
      .click();
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
