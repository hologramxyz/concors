import { test, expect } from "@playwright/test";
import { signedIn } from "./signed-in.ts";

test("compact sidebar search opens the command palette beside the collapse control", async ({
  page,
}) => {
  await signedIn(page);
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  const search = sidebar.getByRole("button", { name: "Search", exact: true });
  await expect(search).toBeVisible();
  const searchBox = await search.boundingBox();
  const collapseBox = await sidebar.getByRole("button", { name: "Collapse sidebar" }).boundingBox();
  if (!searchBox || !collapseBox) throw new Error("Sidebar controls are missing");
  expect(searchBox.y).toBe(collapseBox.y);
  expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(collapseBox.x);
  await expect(page.getByText("Search or jump to…", { exact: true })).toHaveCount(0);
  await search.click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
});
