import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedSupervisorWorkspaces } from "./support/supervisor-fixture.ts";

test("Overview shows each session's status, what it needs, and the gist of its output", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // The agents get their work directly: the Supervisor conversation is shared by later specs.
  const cleanup = await seedSupervisorWorkspaces("ws://127.0.0.1:7429/ws", {
    delegate: false,
    work: true,
  });
  try {
    await signedIn(page, "Simone", undefined, { supervisorLanding: true });
    await page.goto("/");
    const dismissAccount = page.getByRole("button", { name: "Dismiss account connection" });
    if (await dismissAccount.isVisible()) await dismissAccount.click();
    const dismissAnnouncement = page.getByRole("button", { name: "Dismiss iOS app announcement" });
    if (await dismissAnnouncement.isVisible()) await dismissAnnouncement.click();

    await page.getByRole("button", { name: "Overview, 1 need you" }).click();
    const overview = page.getByRole("complementary", { name: "Overview" });
    const needsYou = overview.getByRole("region", { name: "Needs you" });
    await expect(needsYou).toContainText("Game QA");
    await expect(needsYou).toContainText("Approve: pnpm test");
    const working = overview.getByRole("region", { name: "In progress" });
    await expect(working).toContainText("HUD polish");
    // A working session shows its latest update as it streams, refreshed while it works.
    await expect(working).toContainText("Hello from");
    // Done starts folded to its header, which shows the rows' dot for a finish nobody opened.
    const done = overview.getByRole("region", { name: "Done" });
    const doneToggle = done.getByRole("button", { name: "Done", exact: true });
    const headerDot = done.locator("[data-header-unseen]");
    await expect(doneToggle).toHaveAttribute("aria-expanded", "false");
    await expect(done.getByRole("button", { name: /Release editor/ })).toBeHidden();
    await expect(headerDot).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("desktop-overview-done-folded.png"),
      animations: "disabled",
    });
    // Its header opens it, and the open group's rows carry the dot instead.
    await doneToggle.click();
    await expect(doneToggle).toHaveAttribute("aria-expanded", "true");
    await expect(headerDot).toHaveCount(0);
    await expect(done.getByRole("button", { name: /Release editor/ })).toBeVisible();
    // A finished session says what it produced, so it need not be opened to find out.
    await expect(done).toContainText("Release editor");
    await expect(done).toContainText("Hello from Codex");
    await page.screenshot({
      path: test.info().outputPath("desktop-overview.png"),
      animations: "disabled",
    });

    // Ask Supervisor drafts the question; it is not sent, as later specs share this conversation.
    const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
    await needsYou.getByRole("button", { name: "Ask Supervisor" }).click();
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("Should I approve @Game QA’s request “pnpm test”?");
    await composer.fill("");

    // The approval is answered on its row, as in its chat; its result then reads in Done.
    await needsYou.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect(page.getByTestId("supervisor-page")).toBeVisible();
    await expect(overview.getByRole("region", { name: "Needs you" })).toHaveCount(0);
    await expect(done).toContainText("The fixture test suite finished.");
    await page.screenshot({
      path: test.info().outputPath("desktop-overview-resolved.png"),
      animations: "disabled",
    });

    // A row opens its session.
    await done.getByRole("button", { name: /Game QA/ }).click();
    await expect(page.getByTestId("supervisor-page")).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("Overview's approval rows start at the same place, and a long command unfolds from its chevron", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const cleanup = await seedSupervisorWorkspaces("ws://127.0.0.1:7429/ws", {
    delegate: false,
    work: true,
  });
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "approval rows", version: "0.0.0" },
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
    await signedIn(page, "Simone", undefined, { supervisorLanding: true });
    await page.goto("/");
    await page.getByRole("button", { name: "Overview, 2 need you" }).click();
    const needsYou = page
      .getByRole("complementary", { name: "Overview" })
      .getByRole("region", { name: "Needs you" });
    const short = needsYou.getByRole("listitem").filter({ hasText: "Game QA" });
    const long = needsYou.getByRole("listitem").filter({ hasText: "Release editor" });
    await expect(short).toContainText("Approve: pnpm test");
    // Both dots stand at the same place, whether or not the row can unfold.
    const dotLeft = async (row: typeof short) =>
      (await row.getByText("Approve:").evaluate((el) => {
        const dot = el.previousElementSibling;
        return dot ? dot.getBoundingClientRect().left : NaN;
      })) as number;
    expect(await dotLeft(long)).toBe(await dotLeft(short));
    // The short one fits and has nothing to unfold; the long one is one line, cut, and unfolds.
    await expect(short.getByRole("button", { expanded: false })).toHaveCount(0);
    const toggle = long.getByRole("button", { expanded: false });
    await expect(toggle).toBeVisible();
    const code = long.locator("code");
    const box = await code.evaluate((el) => {
      const line = el.parentElement as HTMLElement;
      return {
        lines: line.getBoundingClientRect().height / parseFloat(getComputedStyle(line).lineHeight),
        cut: line.scrollWidth > line.clientWidth,
      };
    });
    expect(box.lines).toBe(1);
    expect(box.cut).toBe(true);
    const before = await dotLeft(long);
    await toggle.click();
    await expect(long.getByRole("button", { expanded: true })).toBeVisible();
    await expect(code).toContainText("echo TIMEOUT");
    expect(
      (await code.evaluate((el) => el.parentElement?.getBoundingClientRect().height)) ?? 0,
    ).toBeGreaterThan(20);
    expect(await dotLeft(long)).toBe(before);
    await page.screenshot({
      path: test.info().outputPath("desktop-approval-unfolded.png"),
      animations: "disabled",
    });
    await long.getByRole("button", { expanded: true }).click();
    await expect(toggle).toBeVisible();
  } finally {
    off();
    control.disconnect();
    await cleanup();
  }
});
