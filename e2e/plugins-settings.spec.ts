import { test, expect, signedIn } from "./signed-in.ts";

test("Settings lists the plugins Claude Code and Codex installed, and turns them on and off", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Settings" });
  const open = () => nav.getByRole("button", { name: "Plugins", exact: true }).click();
  await open();
  const claude = page.getByRole("region", { name: "Claude Code plugins" });
  const codex = page.getByRole("region", { name: "Codex plugins" });
  await expect(claude).toContainText("acme · v1.2.0");
  await expect(codex).toContainText("Ship previews from a chat");
  // An organization's plugin is shown but changed where it is set.
  await expect(claude.getByRole("switch", { name: "house-style" })).toBeDisabled();
  await expect(claude).toContainText("Set by a project or your organization");

  // The fixture CLIs keep their plugins across tests, so each switch is flipped and put back.
  for (const toggle of [
    claude.getByRole("switch", { name: "release-notes" }),
    codex.getByRole("switch", { name: "Deploy" }),
  ]) {
    const before = await toggle.isChecked();
    await toggle.click();
    await expect(toggle).toBeChecked({ checked: !before });
    // It is the CLI's own setting: it reads back the same after leaving the page.
    await nav.getByRole("button", { name: "MCP servers", exact: true }).click();
    await open();
    await expect(toggle).toBeChecked({ checked: !before });
    await toggle.click();
    await expect(toggle).toBeChecked({ checked: before });
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
});
