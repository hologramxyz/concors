import { seedProject } from "./support/projects.ts";
import { test, expect, signedIn } from "./signed-in.ts";

test("two devices use the same terminal and recover its screen after reload", async ({
  browser,
  page,
}) => {
  const context = await browser.newContext();
  const second = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  second.on("pageerror", (error) => errors.push(error.message));
  try {
    await Promise.all([signedIn(page), signedIn(second)]);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    await seedProject(page, "Terminal acceptance", process.cwd());
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start terminal", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Take control", exact: true })).toHaveCount(0);

    await expect
      .poll(() =>
        page
          .getByLabel("Terminal output")
          .filter({ visible: true })
          .filter({ visible: true })
          .evaluate((element) => ({
            horizontal: element.scrollWidth > element.clientWidth,
            vertical: element.scrollHeight > element.clientHeight,
          })),
      )
      .toEqual({ horizontal: false, vertical: false });
    await page.keyboard.type("printf 'hello-%s\\n' shared-terminal");
    await page.keyboard.press("Enter");
    await page.keyboard.type(
      "printf '\\033[34mANSI_BLUE\\033[0m\\n\\033[38;5;196mINDEX_RED\\033[0m\\n\\033[38;2;12;200;140mTRUE_GREEN\\033[0m\\n'",
    );
    await page.keyboard.press("Enter");
    const blue = page.locator(".xterm-rows span").getByText("ANSI_BLUE", { exact: true });
    const indexed = page.locator(".xterm-rows span").getByText("INDEX_RED", { exact: true });
    const trueColor = page.locator(".xterm-rows span").getByText("TRUE_GREEN", { exact: true });
    await expect(blue).toHaveCSS("color", "rgb(51, 93, 206)");
    await expect(indexed).toHaveCSS("color", "rgb(255, 0, 0)");
    await expect(trueColor).toHaveCSS("color", "rgb(12, 200, 140)");
    await expect(page.getByRole("region", { name: "Terminal pane" })).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(blue).toHaveCSS("color", "rgb(118, 155, 255)");
    await expect(trueColor).toHaveCSS("color", "rgb(12, 200, 140)");
    await expect(page.getByRole("region", { name: "Terminal pane" })).toHaveCSS(
      "background-color",
      "rgb(27, 27, 27)",
    );
    await page.screenshot({ path: "test-results/terminal-neutral-dark.png" });
    await second.goto("http://localhost:1420");
    await expect(second.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "hello-shared-terminal",
    );
    await second.reload();
    await expect(second.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "hello-shared-terminal",
    );
    await expect(
      second.locator(".xterm-rows span").getByText("TRUE_GREEN", { exact: true }),
    ).toHaveCSS("color", "rgb(12, 200, 140)");
    await second.getByLabel("Terminal output").filter({ visible: true }).click();
    await second.keyboard.type("printf 'second-%s\\n' device");
    await second.keyboard.press("Enter");
    await expect(page.getByLabel("Terminal output").filter({ visible: true })).toContainText(
      "second-device",
    );
    await second.keyboard.type("exit");
    await second.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Start new session", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
