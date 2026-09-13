import { test, expect } from "@playwright/test";

test("direct desktop cloning uses a URL and never requests cloud GitHub access", async ({
  page,
}) => {
  const githubRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/github")) githubRequests.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const open = async () => {
    await ui.getByRole("button", { name: "Open workspace menu", exact: true }).click();
    await ui.getByRole("button", { name: "Clone repository…", exact: true }).click();
  };
  await open();
  const clone = ui.getByRole("dialog", { name: "Clone repository", exact: true });
  await expect(clone.getByRole("button", { name: "GitHub repositories", exact: true })).toHaveCount(
    0,
  );
  await clone
    .getByRole("textbox", { name: "Repository URL or local path", exact: true })
    .fill("https://github.com/example/repository.git");
  await clone.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    clone.getByText("Cloning uses Git credentials on the connected desktop.", { exact: true }),
  ).toBeVisible();
  await clone.getByRole("button", { name: "Cancel", exact: true }).click();
  await open();
  await expect(
    clone.getByRole("textbox", { name: "Repository URL or local path", exact: true }),
  ).toHaveValue("");
  expect(githubRequests).toEqual([]);
});
