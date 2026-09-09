import { expect, test, type Page } from "@playwright/test";

async function openWorkspace(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("button", { name: "Development", exact: true }).click();
  await expect(page.getByText("Mobile launch", { exact: true }).first()).toBeVisible();
}

test("phone preview signs in, approves a request, and streams a conversation", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openWorkspace(page);
  await page.getByRole("button", { name: "Agent conversation", exact: true }).click();
  await expect(page.getByText("Run the test suite?", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("mobile-approval.png") });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Test the mobile client");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText(/This is a simulated response.*actual output here\./)).toBeVisible();
  await page.screenshot({ path: info.outputPath("mobile-chat.png") });
  expect(errors).toEqual([]);
});

test("bundled terminal starts, accepts input, reloads, and confirms stopping", async ({
  page,
}, info) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Terminal 2", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Interactive terminal"]');
  await expect(page.getByRole("button", { name: "Show keyboard", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Show keyboard", exact: true }).click();
  await frame.locator(".xterm-helper-textarea").pressSequentially("ls");
  await frame.locator(".xterm-helper-textarea").press("Enter");
  await expect(frame.locator(".xterm-accessibility-tree")).toContainText("ls");
  await page.getByRole("button", { name: "Reload terminal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show keyboard", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("mobile-terminal.png") });
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
  ).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await expect(page.getByText("This stops the process for every connected device.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Take control", exact: true })).toBeDisabled();
});

test("cold links require sign-in, then resolve only authorized sessions; sign-out clears access", async ({
  page,
}) => {
  await page.goto(
    "/session?machineId=11111111-1111-4111-8111-111111111111&projectId=33333333-3333-4333-8333-333333333333&sessionId=66666666-6666-4666-8666-666666666666",
  );
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  // Web credentials deliberately live in memory only, never local/session storage.
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => /token|session|auth/i.test(key)),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: /back/i }).click();
  await page.getByRole("tab", { name: /Settings/ }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore demo", exact: true })).toBeVisible();
});
