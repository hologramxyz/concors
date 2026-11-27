import {
  DaemonConnection,
  describeDaemonEndpoint,
} from "../../../packages/daemon-client/src/index.ts";
import { test, expect } from "./fixtures";
import { mobileDesktopSocket } from "../../../e2e/support/mobile-direct-ports.cjs";
import { seedSupervisorWorkspaces } from "../../../e2e/support/supervisor-fixture.ts";

test("the phone shows Overview in a drawer and mentions an agent with @", async ({ page }) => {
  test.setTimeout(180_000);
  const cleanup = await seedSupervisorWorkspaces(mobileDesktopSocket, {
    delegate: false,
    work: true,
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    const dismissAccount = ui.getByRole("button", { name: "Dismiss account connection" });
    if (await dismissAccount.isVisible()) await dismissAccount.click();
    await ui.getByRole("button", { name: "Overview, 1 need you" }).click();
    const drawer = ui.getByRole("dialog", { name: "Overview" });
    await expect(drawer).toHaveAttribute("data-mobile-drawer", "true");
    await expect(drawer.getByRole("region", { name: "Needs you" })).toContainText(
      "Approve: pnpm test",
    );
    // Done starts folded to its header, its dot standing for the finish nobody has opened.
    const done = drawer.getByRole("region", { name: "Done" });
    const doneToggle = done.getByRole("button", { name: "Done", exact: true });
    await expect(doneToggle).toHaveAttribute("aria-expanded", "false");
    await expect(done.locator("[data-header-unseen]")).toBeVisible();
    await doneToggle.click();
    await expect(done.locator("[data-header-unseen]")).toHaveCount(0);
    await expect(done.getByText("Hello from Codex").first()).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("mobile-overview.png"),
      animations: "disabled",
    });
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    const composer = ui.getByRole("textbox", { name: "Message Codex", exact: true });
    await composer.fill("Ask @ga");
    await expect(ui.getByRole("listbox", { name: "Mention" })).toContainText("Game QA");
    await page.screenshot({
      path: test.info().outputPath("mobile-mentions.png"),
      animations: "disabled",
    });
    await ui.getByRole("option", { name: /Game QA/ }).click();
    await expect(composer).toHaveValue("Ask @Game QA ");
  } finally {
    await cleanup();
  }
});

test("the phone Overview keeps the answers as close under a long command as under a short one", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const cleanup = await seedSupervisorWorkspaces(mobileDesktopSocket, {
    delegate: false,
    work: true,
  });
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint(mobileDesktopSocket),
    client: { kind: "test", name: "phone approval rows", version: "0.0.0" },
  });
  const off = control.subscribeWorkspace(() => undefined);
  try {
    await control.connect();
    await expect.poll(() => control.workspace).not.toBeNull();
    // Release editor asks to run a command too long for one line; Game QA's "pnpm test" fits.
    const sent = await control.requestAgent(
      { kind: "send", sessionId: cleanup.notes, text: "Please approve the long command" },
      crypto.randomUUID(),
    );
    expect(sent.outcome.status).toBe("ok");
    await expect
      .poll(() => control.agents.find((a) => a.id === cleanup.notes)?.status)
      .toBe("needs_input");
    await page.goto("/");
    await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    const dismissAccount = ui.getByRole("button", { name: "Dismiss account connection" });
    if (await dismissAccount.isVisible()) await dismissAccount.click();
    // The phone's daemon keeps the earlier test's chats, so it counts theirs too.
    await ui.getByRole("button", { name: /^Overview, \d+ need you$/ }).click();
    const needsYou = ui
      .getByRole("dialog", { name: "Overview" })
      .getByRole("region", { name: "Needs you" });
    const long = needsYou.getByRole("listitem").filter({ hasText: "Release editor" });
    const short = needsYou.getByRole("listitem").filter({ hasText: "Game QA" }).first();
    await expect(long.getByRole("button", { expanded: false })).toBeVisible();
    // From the bottom of the command's line to the top of Allow once.
    const gap = (row: typeof long) =>
      row.evaluate((li) => {
        const line = li.querySelector("code")?.parentElement?.parentElement;
        const allow = [...li.querySelectorAll("button")].find(
          (b) => b.textContent === "Allow once",
        );
        if (!line || !allow) return NaN;
        return allow.getBoundingClientRect().top - line.getBoundingClientRect().bottom;
      });
    expect(await gap(long)).toBe(await gap(short));
  } finally {
    off();
    control.disconnect();
    await cleanup();
  }
});
