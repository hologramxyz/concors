import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { chooseProvider } from "./support/agents.ts";

test("the context ring shows the conversation's window and the plan's usage bars", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-plan-usage-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Plan usage", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    const message = page.getByRole("textbox", { name: "Message Codex" });
    // The fixture reports context usage with its "rich" turn.
    await message.fill("rich");
    await page.getByRole("button", { name: "Send message", exact: true }).click();

    // The fixture reports 32k of a 128k window with its turn.
    const ring = page.getByRole("button", { name: "Context window", exact: true });
    await expect(ring).toHaveAttribute("title", "25% context used");
    await ring.click();
    const context = page.getByRole("region", { name: "Context window" });
    await expect(context).toContainText("32k / 128k tokens · 25% used");

    const plan = page.getByRole("region", { name: "Plan usage" });
    await expect(plan).toContainText("Max 20x");
    const bars = plan.getByRole("progressbar");
    await expect(bars).toHaveCount(3);
    await expect(plan.getByRole("listitem").nth(0)).toContainText("Session");
    await expect(plan.getByRole("listitem").nth(0)).toContainText(/42% · resets in (1h 5\d|2h)/);
    await expect(plan.getByRole("listitem").nth(1)).toContainText(
      /Weekly13% · resets in 2d 2\dh|Weekly13% · resets in 3d/,
    );
    await expect(plan.getByRole("listitem").nth(2)).toContainText("Weekly · Fable91%");
    await expect(bars.nth(0)).toHaveAttribute("aria-valuenow", "42");
    // A nearly used-up window stands out.
    await expect(bars.nth(2).locator("[data-usage-tone]")).toHaveAttribute(
      "data-usage-tone",
      "danger",
    );
    await expect(bars.nth(0).locator("[data-usage-tone]")).toHaveAttribute("data-usage-tone", "ok");
    await page.screenshot({ path: test.info().outputPath("plan-usage.png") });

    await page.getByRole("button", { name: "Refresh plan usage", exact: true }).click();
    await expect(bars).toHaveCount(3);
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
