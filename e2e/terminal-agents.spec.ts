import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { signedIn } from "./signed-in.ts";

test("Codex terminal profiles appear across clients and agent clicks focus the owning split pane", async ({
  page,
  browser,
}) => {
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
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    const agents = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("region", { name: "Agents", exact: true });
    await expect(agents.getByRole("button", { name: /Running in terminal/ })).toHaveCount(0);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Codex", exact: true }).click();
    await expect(agents.getByRole("button", { name: /Running in terminal.*Codex/ })).toHaveCount(1);
    await expect(page.getByLabel("Terminal output")).toContainText("CODEX_TERMINAL_READY");
    await page.getByRole("button", { name: "Pane actions" }).click();
    await page.getByRole("menuitem", { name: "Split horizontally" }).click();
    await page.getByRole("button", { name: "Start codex", exact: true }).click();
    await expect(agents.getByRole("button", { name: /Running in terminal.*Codex/ })).toHaveCount(2);
    const panes = page.getByRole("region", { name: "Codex pane", exact: true });
    const firstPaneId = await panes.first().getAttribute("data-pane-id");
    const lastPaneId = await panes.last().getAttribute("data-pane-id");
    await expect(panes.last().getByLabel("Terminal output")).toContainText("CODEX_TERMINAL_READY");

    await second.goto("http://localhost:1420");
    const remoteAgents = second
      .getByRole("navigation", { name: "Primary" })
      .getByRole("region", { name: "Agents", exact: true });
    await expect(
      remoteAgents.getByRole("button", { name: /Running in terminal.*Codex/ }),
    ).toHaveCount(2);
    await second.reload();
    await expect(
      remoteAgents.getByRole("button", { name: /Running in terminal.*Codex/ }),
    ).toHaveCount(2);
    await second.getByRole("button", { name: /^Account:/ }).click();
    await second.getByRole("menuitem", { name: "Settings", exact: true }).click();

    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await agents
      .getByRole("button", { name: /Running in terminal.*Codex/ })
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
      .getByRole("button", { name: /Running in terminal.*Codex/ })
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
    await expect(remoteAgents.getByRole("button", { name: /Failed.*Codex/ })).toHaveCount(1);
    await expect(
      remoteAgents.getByRole("button", { name: /Running in terminal.*Codex/ }),
    ).toHaveCount(1);
    await remoteAgents.getByRole("button", { name: /Running in terminal.*Codex/ }).click();
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
    await page.screenshot({ path: "test-results/terminal-agents.png" });
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
