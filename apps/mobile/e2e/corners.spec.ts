import { expect, test, type FrameLocator, type Locator } from "@playwright/test";

test.use({ actionTimeout: 15_000 });

async function openSettings(ui: FrameLocator) {
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await ui.getByRole("button", { name: /^Account:/ }).click();
  await ui.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("combobox", { name: "Settings section" }).click();
  await ui.getByRole("option", { name: "Appearance", exact: true }).click();
  return settings;
}

async function assertSquare(root: Locator) {
  // Check actual rendered geometry, including shared desktop controls and portaled drawers.
  // Shape-option previews intentionally illustrate the three alternatives.
  await expect
    .poll(() =>
      root.evaluate((root) =>
        [...root.querySelectorAll<HTMLElement>("*")].flatMap((element) => {
          const style = getComputedStyle(element);
          if (element.hasAttribute("data-corner-preview") || !element.checkVisibility()) return [];
          const radii = [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomLeftRadius,
            style.borderBottomRightRadius,
          ];
          return radii.some((radius) => parseFloat(radius) > 0)
            ? [
                {
                  tag: element.tagName,
                  label: element.getAttribute("aria-label"),
                  class: element.className,
                  radii,
                },
              ]
            : [];
        }),
      ),
    )
    .toEqual([]);
}

for (const mode of ["light", "dark"] as const) {
  test(`${mode} mobile shape theme covers glass, sheets, avatars, files and composer`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: "Explore demo" }).click();
    const ui = page.frameLocator('iframe[title="Concors workspace"]');
    const input = ui.getByRole("textbox", { name: "Message Codex" });
    await expect(input).toBeVisible();
    await input.fill("Shape changes keep this draft");

    for (const shape of ["Square", "Rounded", "Slightly rounded", "Square"] as const) {
      const settings = await openSettings(ui);
      await settings.getByText(shape, { exact: true }).click();
      await expect(settings.getByRole("radio", { name: shape, exact: true })).toBeChecked();
      const square = shape === "Square";
      const controlRadius = square ? "0px" : shape === "Rounded" ? "9999px" : "6px";
      await expect(settings.getByRole("button", { name: "Close", exact: true })).toHaveCSS(
        "border-radius",
        controlRadius,
      );
      await expect(settings).toHaveCSS(
        "border-top-left-radius",
        square ? "0px" : shape === "Rounded" ? "48px" : "24px",
      );
      if (square) await assertSquare(ui.locator("body"));
      await settings.getByRole("button", { name: "Close", exact: true }).click();

      await expect(ui.locator(".mobile-header .mobile-glass").first()).toHaveCSS(
        "border-radius",
        controlRadius,
      );
      await expect(input).toHaveValue("Shape changes keep this draft");
      await input.click();
      await expect(ui.locator(".mobile-composer-primary > button")).toHaveCSS(
        "border-radius",
        controlRadius,
      );
      if (square) await assertSquare(ui.locator("body"));

      await ui.getByRole("combobox", { name: "Tabs", exact: true }).click();
      if (square) await assertSquare(ui.locator("body"));
      const tabs = ui.getByRole("dialog", { name: "Tabs", exact: true });
      await expect(tabs.getByRole("button", { name: "Close", exact: true })).toHaveCSS(
        "border-radius",
        controlRadius,
      );
      await tabs.getByRole("button", { name: "New tab", exact: true }).click();
      if (square) await assertSquare(ui.locator("body"));
      await ui
        .getByRole("dialog", { name: "New tab", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();

      await ui.getByRole("button", { name: "Project files", exact: true }).click();
      await expect(ui.locator(".mobile-files-header .mobile-glass").first()).toHaveCSS(
        "border-radius",
        controlRadius,
      );
      if (square) await assertSquare(ui.locator("body"));
      await ui.getByRole("button", { name: "Back to chat", exact: true }).click();

      await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
      await expect(ui.locator(".mobile-account-trigger [data-account-avatar]")).toHaveCSS(
        "border-radius",
        controlRadius,
      );
      await expect(ui.getByRole("button", { name: "Search workspace", exact: true })).toHaveCSS(
        "border-radius",
        controlRadius,
      );
      if (square) {
        await expect(ui.locator(".mobile-main")).toHaveCSS("clip-path", "inset(3px)");
        await assertSquare(ui.locator("body"));
      }
      if (shape !== "Slightly rounded") {
        await page.screenshot({
          path: test.info().outputPath(`sidebar-${shape.toLowerCase()}.png`),
        });
      }
      await ui.getByRole("button", { name: "Search workspace", exact: true }).click();
      if (square) await assertSquare(ui.locator("body"));
      await page.keyboard.press("Escape");
      await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
      if (square) await assertSquare(ui.locator("body"));
      await ui
        .getByRole("dialog", { name: "Machine", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();

      await ui.getByRole("button", { name: /^Account:/ }).click();
      const account = ui.getByRole("dialog", { name: "Account", exact: true });
      await expect(account.locator("[data-account-avatar]")).toHaveCSS(
        "border-radius",
        controlRadius,
      );
      if (square) await assertSquare(ui.locator("body"));
      await account.getByRole("button", { name: "Close", exact: true }).click();
      await ui.getByRole("button", { name: "Return to workspace", exact: true }).click();
    }
    // A host screen must retain the shape after the workspace unmounts.
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: /^Account:/ }).click();
    await ui.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("button", { name: "Explore demo" })).toHaveCSS(
      "border-radius",
      "0px",
    );
    // The demo entry has no login fields; the direct-profile scenario checks native host fields.
    await expect(page.getByRole("img", { name: "Concors", exact: true })).toHaveCSS(
      "border-radius",
      "0px",
    );
  });
}
