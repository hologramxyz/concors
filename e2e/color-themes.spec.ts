import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("palettes persist and agent-written themes reload without replacing terminal sessions", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const starts: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (event) => {
      const message = JSON.parse(String(event.payload));
      if (message.type === "terminal.request" && message.operation.kind === "start")
        starts.push(message.requestId);
    }),
  );
  await signedIn(page);
  await page.goto("/");
  await seedProject(page, "Theme workspace", process.cwd());
  const terminal = page.getByLabel("Terminal output").filter({ visible: true });
  await expect(terminal).toHaveAttribute("aria-busy", "false");
  await terminal.click();
  await page.keyboard.type("printf 'theme-session-%s\\n' stays");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("theme-session-stays");
  await page.keyboard.press("Control+Shift+Comma");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Concors", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Cobalt", exact: true }).locator("..").click();
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", "cobalt");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--terminal-background").trim(),
      ),
    )
    .toBe("#171f32");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", "cobalt");
  await expect(terminal).toContainText("theme-session-stays");
  await page.keyboard.press("Control+Shift+Comma");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByLabel("Theme directory")).toBeVisible();
  const directory = await page.getByLabel("Theme directory").innerText();
  await mkdir(directory, { recursive: true });
  const id = `test-${crypto.randomUUID()}`;
  const file = join(directory, `${id}.json`),
    temp = join(directory, `${id}.tmp`);
  const theme = {
    version: 1,
    id,
    name: "Agent sunset",
    extends: "sand",
    dark: { accent: "#ffaa77", terminal: { red: "#ee8877" } },
  };
  try {
    await writeFile(file, JSON.stringify(theme));
    await expect(page.getByRole("radio", { name: "Agent sunset", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("radio", { name: "Agent sunset", exact: true }).locator("..").click();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", id);
    const primary = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
      );
    await expect.poll(primary).toBe("#ffaa77");
    await writeFile(temp, JSON.stringify({ ...theme, dark: { ...theme.dark, accent: "#aaccff" } }));
    await rename(temp, file);
    await expect.poll(primary, { timeout: 10_000 }).toBe("#aaccff");
    await writeFile(file, "{ incomplete");
    await expect(page.getByRole("status").filter({ hasText: "Invalid JSON" })).toBeVisible({
      timeout: 10_000,
    });
    await expect.poll(primary).toBe("#aaccff");
    await page.screenshot({ path: "test-results/color-themes-dark.png" });
    await rm(file);
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "concors", {
      timeout: 10_000,
    });
    await page.getByRole("radio", { name: "Ocean", exact: true }).locator("..").click();
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    await page.getByRole("menuitem", { name: "Light", exact: true }).click();
    await page.screenshot({ path: "test-results/color-themes-light.png" });
    await page.getByRole("radio", { name: "Concors", exact: true }).locator("..").click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--primary")))
      .toBe("");
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(terminal).toContainText("theme-session-stays");
    expect(starts).toHaveLength(1);
  } finally {
    await rm(file, { force: true });
    await rm(temp, { force: true });
  }
});
