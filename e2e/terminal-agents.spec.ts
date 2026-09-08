import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

test("Codex terminal profiles appear across clients and agent clicks focus the owning split pane", async ({
  page,
  browser,
}) => {
  test.setTimeout(45_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-terminal-agents-"));
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.goto("/");
    await page.getByRole("button", { name: "Add project", exact: true }).first().click();
    await page.getByLabel("Project name", { exact: true }).fill("Terminal agents");
    await page.getByLabel("Folder on this machine").fill(directory);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    const agents = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("region", { name: "Agents", exact: true });
    await expect(agents.getByRole("button", { name: /Open in terminal/ })).toHaveCount(0);
    // Starting an agent from a normal shell must be discovered without changing its profile.
    const shellPane = page.getByRole("region", { name: "Terminal pane", exact: true });
    const shellPaneId = await shellPane.getAttribute("data-pane-id");
    await shellPane.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("codex");
    await page.keyboard.press("Enter");
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(1);
    await expect(shellPane.getByLabel("Terminal output")).toContainText("CODEX_TERMINAL_READY");
    await second.goto("http://localhost:1420");
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
    await expect(agents.getByLabel("Agent status: Working")).toBeVisible();
    await expect(second.getByLabel("Agent status: Working")).toBeVisible();
    await second.keyboard.type("test-approval");
    await second.keyboard.press("Enter");
    await expect(agents.getByLabel("Agent status: Needs input")).toBeVisible();
    await second.keyboard.type("test-idle");
    await second.keyboard.press("Enter");
    await expect(shellAgent).toBeVisible();
    await expect(agents.getByLabel("Agent status: Working")).toHaveCount(0);
    await second.keyboard.type("exit");
    await second.keyboard.press("Enter");
    await expect(shellAgent).toHaveCount(0);
    await expect(agents.getByRole("button", { name: /Open in terminal/ })).toHaveCount(0);

    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(1);
    await agents.getByRole("button", { name: /Open in terminal.*Codex/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("Terminal agents");
    await page.mouse.move(0, 0);
    await expect(page.getByLabel("Terminal output")).toContainText("CODEX_TERMINAL_READY");
    await expect(agents.getByLabel("Agent status: Open in terminal").locator("svg")).toHaveCount(0);
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally" }).click();
    await expect(
      page.getByRole("region", { name: "Codex pane", exact: true }).locator(".xterm"),
    ).toHaveCount(2);
    await expect(agents.getByRole("button", { name: /Open in terminal.*Codex/ })).toHaveCount(2);
    const panes = page.getByRole("region", { name: "Codex pane", exact: true });
    const firstPaneId = await panes.first().getAttribute("data-pane-id");
    const lastPaneId = await panes.last().getAttribute("data-pane-id");
    await expect(panes.last().getByLabel("Terminal output")).toContainText("CODEX_TERMINAL_READY");

    await second.goto("http://localhost:1420");
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

    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await agents
      .getByRole("button", { name: /Open in terminal.*Codex/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Codex", exact: true })).toHaveAttribute(
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
    await expect(panes.last().getByLabel("Terminal output")).toContainText(
      "CODEX_REPLY:second-pane",
    );
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
