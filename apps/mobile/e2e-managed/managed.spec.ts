import { test, expect } from "@playwright/test";
import { signedIn } from "../../../e2e/signed-in.ts";
import { managedHost } from "../../../e2e/support/managed-host.ts";
import { seedProject } from "../../../e2e/support/projects.ts";

test("phone and desktop discover a managed machine and share one real terminal", async ({
  browser,
  page: desktop,
}) => {
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await phoneContext.newPage();
  try {
    await signedIn(desktop);
    const desktopHost = await managedHost(desktop);
    await signedIn(phone);
    const phoneHost = await managedHost(phone, true);
    // An older control plane has no optional mobile capabilities endpoint.
    await phone.route("**/api/v1/mobile/capabilities", (route) =>
      route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, json: {} }),
    );
    await desktop.goto("/");
    await desktop.getByRole("button", { name: "Switch machine", exact: true }).click();
    await desktop.getByRole("menuitem", { name: /Second machine Online/i }).click();
    await seedProject(desktop, "Managed companion acceptance", "/tmp", {
      url: "ws://127.0.0.1:7430/ws",
    });
    await expect(
      desktop.getByRole("heading", { name: "Managed companion acceptance", exact: true }),
    ).toBeVisible();
    const desktopTerminal = desktop.locator(".concors-terminal");
    await expect(desktopTerminal).toBeVisible();
    // The preview starts with a session (see playwright.managed.config.mts).
    await phone.goto("http://localhost:8088");
    const ui = phone.frameLocator('iframe[title="Concors workspace"]');
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
    await expect(
      ui.getByRole("option", { name: /Provisioning machine Provisioning/ }),
    ).toBeDisabled();
    await expect(ui.getByRole("option", { name: /Offline machine Offline/ })).toBeDisabled();
    await ui.getByRole("option", { name: /Second machine Online/ }).click();
    await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
    await expect(ui.getByRole("option", { name: /Second machine Connected/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await ui.getByRole("dialog", { name: "Machine", exact: true }).press("Escape");
    await ui.getByRole("button", { name: "Return to workspace", exact: true }).click();
    const phoneTerminal = ui.getByLabel("Terminal output", { exact: true });
    await expect(phoneTerminal).toBeVisible();
    await phoneTerminal.click();
    await phone.keyboard.type("printf 'phone-%s\\n' managed-companion");
    await phone.keyboard.press("Enter");
    await expect(phoneTerminal).toContainText("phone-managed-companion");
    await expect(desktopTerminal).toContainText("phone-managed-companion");
    await desktopTerminal.click();
    await desktop.keyboard.type("printf 'desktop-%s\\n' managed-companion");
    await desktop.keyboard.press("Enter");
    await expect(phoneTerminal).toContainText("desktop-managed-companion");
    expect(phoneHost.tokenCount()).toBe(1);
    expect(desktopHost.tokenCount()).toBe(1);
    await desktop.keyboard.type("exit");
    await desktop.keyboard.press("Enter");
  } finally {
    await phoneContext.close();
  }
});
