import { test, expect, type WebSocketRoute } from "@playwright/test";

test("two devices share workspace edits, reconnect, and switch isolated machines", async ({
  browser,
  page: first,
}) => {
  const otherDevice = await browser.newContext();
  let disconnected = false;
  const sockets: WebSocketRoute[] = [];
  await otherDevice.routeWebSocket("**/ws", (socket) => {
    if (disconnected) {
      socket.close();
      return;
    }
    socket.connectToServer();
    sockets.push(socket);
  });
  const second = await otherDevice.newPage();
  const errors: string[] = [];
  first.on("pageerror", (error) => errors.push(error.message));
  second.on("pageerror", (error) => errors.push(error.message));
  try {
    await Promise.all([first.goto("/"), second.goto("http://localhost:1420")]);
    await first.getByRole("button", { name: "Add project", exact: true }).first().click();
    await first.getByLabel("Project name", { exact: true }).fill("Concors acceptance");
    await first.getByLabel("Folder on this machine").fill("/tmp");
    await first
      .getByRole("dialog")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await expect(
      second.getByRole("heading", { name: "Concors acceptance", exact: true }),
    ).toBeVisible();
    await first.getByRole("button", { name: "New tab", exact: true }).click();
    await expect(second.getByRole("region", { name: "Terminal pane", exact: true })).toHaveCount(1);
    await first.getByRole("button", { name: "Split horizontally", exact: true }).click();
    await expect(second.getByRole("region", { name: "Terminal pane", exact: true })).toHaveCount(2);
    await second.getByLabel("Pane profile").last().selectOption("chat");
    await expect(first.getByRole("region", { name: "Unified chat pane", exact: true })).toHaveCount(
      1,
    );
    await first.getByRole("separator", { name: "Resize split" }).focus();
    await first.keyboard.press("ArrowRight");
    await expect(second.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-valuenow",
      "55",
    );
    await first.getByRole("button", { name: "Rename tab", exact: true }).click();
    await first.getByLabel("Tab name", { exact: true }).fill("Build and review");
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      second.getByRole("button", { name: "Build and review", exact: true }),
    ).toBeVisible();
    await second.reload();
    await expect(
      second.getByRole("region", { name: "Unified chat pane", exact: true }),
    ).toHaveCount(1);
    await expect(second.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-valuenow",
      "55",
    );

    disconnected = true;
    for (const socket of sockets.splice(0)) socket.close();
    await expect(second.getByRole("button", { name: "New tab", exact: true })).toBeDisabled();
    await first.getByRole("button", { name: "New tab", exact: true }).click();
    disconnected = false;
    await expect(second.getByRole("button", { name: "Tab 2", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const tabs = first.getByLabel("Project tabs");
    await tabs
      .getByRole("button", { name: "Tab 2", exact: true })
      .dragTo(tabs.getByRole("button", { name: "Build and review", exact: true }));
    await expect
      .poll(() =>
        second
          .getByLabel("Project tabs")
          .locator("[data-tab-id] > button:first-child")
          .allTextContents(),
      )
      .toEqual(["Tab 2", "Build and review"]);
    await second.getByRole("button", { name: "Build and review", exact: true }).click();
    await expect(
      first.getByRole("button", { name: "Build and review", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await second.getByRole("button", { name: "Close pane", exact: true }).last().click();
    await expect(first.getByRole("region", { name: "Unified chat pane", exact: true })).toHaveCount(
      0,
    );
    await expect(first.getByRole("region", { name: "Terminal pane", exact: true })).toHaveCount(1);
    await expect(first.getByRole("separator", { name: "Resize split" })).toHaveCount(0);

    await first.getByRole("button", { name: "Switch machine", exact: true }).click();
    await first.getByRole("menuitem", { name: "Connect a machine…", exact: true }).click();
    await first.getByLabel("Machine name", { exact: true }).fill("Second machine");
    await first.getByLabel("Daemon URL", { exact: true }).fill("http://127.0.0.1:7430");
    await first.getByRole("button", { name: "Add connection", exact: true }).click();
    await expect(
      first.getByRole("heading", { name: "Your projects, in one place", exact: true }),
    ).toBeVisible();
    await expect(
      second.getByRole("heading", { name: "Concors acceptance", exact: true }),
    ).toBeVisible();
    await first.getByRole("button", { name: "Switch machine", exact: true }).click();
    await first.getByRole("menuitem", { name: "This computer", exact: true }).click();
    await expect(
      first.getByRole("heading", { name: "Concors acceptance", exact: true }),
    ).toBeVisible();
    await expect(
      first.getByRole("button", { name: "Build and review", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  } finally {
    await otherDevice.close();
  }
});
