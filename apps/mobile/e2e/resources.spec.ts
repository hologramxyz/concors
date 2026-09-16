import { expect, test } from "@playwright/test";

test("mobile keeps previews in the sidebar and process inspection in computer Resources", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo" }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await ui.locator("#mobile-sidebar-toggle").click();
  const sidebar = ui.getByRole("navigation", { name: "Primary" });
  await expect(sidebar.getByRole("button", { name: "Previews", exact: true })).toBeVisible();
  await expect(sidebar).not.toContainText("Test runner");
  await sidebar.getByRole("button", { name: "Add preview", exact: true }).click();
  const add = ui.getByRole("dialog", { name: "Add preview", exact: true });
  await add.getByRole("textbox", { name: "Name", exact: true }).fill("Web app");
  await add.getByRole("textbox", { name: "Preview URL" }).fill("http://preview.example/");
  await expect(add.getByRole("button", { name: "Save preview" })).toBeDisabled();
  await add.getByRole("textbox", { name: "Preview URL" }).fill("https://preview.example/");
  await add.getByRole("button", { name: "Save preview" }).click();
  await expect(
    sidebar.getByRole("button", { name: "Open preview: Web app", exact: true }),
  ).toBeVisible();
  const preview = sidebar.getByRole("button", { name: "Open preview: Web app", exact: true });
  await preview.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: 300,
  });
  const editAction = ui.getByRole("menuitem", { name: "Edit preview", exact: true });
  await expect(editAction).toBeVisible();
  // The open modal menu hides the sidebar from the accessibility tree, but the
  // original touch target still receives the pointer release.
  await ui.locator('button[aria-label="Open preview: Web app"]').dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 1,
    button: 0,
  });
  await editAction.click();
  const edit = ui.getByRole("dialog", { name: "Edit preview", exact: true });
  await expect(edit.getByRole("textbox", { name: "Preview URL" })).toHaveValue(
    "https://preview.example/",
  );
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.screenshot({ path: "test-results/mobile-previews-sidebar.png" });
  await ui.getByRole("combobox", { name: "Machine", exact: true }).click();
  const machine = ui.getByRole("dialog", { name: "Machine", exact: true });
  await machine.getByRole("button", { name: "Resources", exact: true }).click();
  const drawer = ui.getByRole("dialog", { name: "Resources", exact: true });
  await expect(drawer).toContainText("Test runner");
  await expect(drawer).toContainText("512.0 MiB RAM");
  await expect(drawer.getByRole("button", { name: "Scan storage" })).toHaveCount(0);
  await expect(drawer).not.toContainText("Storage & cleanup");
  const rows = drawer.getByRole("list", { name: "Running processes" });
  await expect(rows.locator("details[open]")).toHaveCount(0);
  expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await rows.locator("summary").filter({ hasText: "Test runner" }).click();
  await rows.getByRole("button", { name: /^Stop Test runner/ }).click();
  const stop = ui.getByRole("dialog", { name: "Stop process?" });
  await expect(stop).toContainText("Child processes can remain");
  await stop.getByRole("button", { name: "Cancel" }).click();
  await expect(drawer).toContainText("Test runner");
  await page.screenshot({ path: "test-results/mobile-resources.png" });
});
