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
    await phone.route("**/api/auth/sign-in/email", async (route) => {
      await route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: {
          token: "e2e-session-token",
          user: {
            id: "e2e-user",
            name: "E2E User",
            email: "e2e@example.com",
            emailVerified: true,
            image: null,
            createdAt: "2026-09-07T00:00:00Z",
            updatedAt: "2026-09-07T00:00:00Z",
          },
        },
      });
    });
    // An older control plane has no optional mobile capabilities endpoint.
    await phone.route("**/api/v1/mobile/capabilities", (route) =>
      route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, json: {} }),
    );
    await desktop.goto("/");
    await desktop.getByRole("button", { name: "Switch machine", exact: true }).click();
    await desktop.getByRole("menuitem", { name: /Second machine connectable/i }).click();
    await seedProject(desktop, "Managed companion acceptance", "/tmp", "ws://127.0.0.1:7430/ws");
    await expect(
      desktop.getByRole("heading", { name: "Managed companion acceptance", exact: true }),
    ).toBeVisible();
    const desktopTerminal = desktop.locator(".concors-terminal");
    await expect(desktopTerminal).toBeVisible();
    await phone.goto("http://localhost:8088");
    await phone.getByRole("textbox", { name: "Email", exact: true }).fill("e2e@example.com");
    await phone.getByRole("textbox", { name: "Password", exact: true }).fill("test-password");
    await phone.getByRole("button", { name: "Sign in", exact: true }).click();
    await phone.getByRole("button", { name: "Allow AI data sharing", exact: true }).click();
    const ui = phone.frameLocator('iframe[title="Concors workspace"]');
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
    await expect(
      ui.getByRole("option", { name: /Provisioning machine provisioning/ }),
    ).toBeDisabled();
    await expect(ui.getByRole("option", { name: /Offline machine offline/ })).toBeDisabled();
    await ui.getByRole("option", { name: /Second machine connectable/ }).click();
    await ui.getByRole("button", { name: "Close sidebar", exact: true }).click();
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
