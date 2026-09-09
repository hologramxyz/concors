import type { WebSocketRoute } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";

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
    await Promise.all([signedIn(first), signedIn(second)]);
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
    const sidebar = first.getByRole("navigation", { name: "Primary" });
    const projectsSection = sidebar.getByRole("button", { name: "Projects", exact: true });
    await projectsSection.click();
    await expect(projectsSection).toHaveAttribute("aria-expanded", "false");
    await expect(
      sidebar.getByRole("button", { name: "Concors acceptance", exact: true }),
    ).toBeHidden();
    await projectsSection.click();
    await expect(
      sidebar.getByRole("button", { name: "Concors acceptance", exact: true }),
    ).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(sidebar.getByRole("button", { name: "Servers", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(first.getByRole("button", { name: "Sessions", exact: true })).toHaveCount(0);
    await expect(second.getByRole("region", { name: "Terminal pane", exact: true })).toHaveCount(1);
    await first.getByRole("button", { name: "Pane actions", exact: true }).click();
    await first.getByRole("menuitem", { name: "Split horizontally", exact: true }).click();
    await expect(second.getByRole("region", { name: "Terminal pane", exact: true })).toHaveCount(2);
    await expect(first.locator(".concors-terminal .xterm")).toHaveCount(2);
    await expect(second.locator(".concors-terminal .xterm")).toHaveCount(2);
    await expect(first.getByRole("button", { name: "Start terminal", exact: true })).toHaveCount(0);
    await second.getByRole("button", { name: "Pane actions", exact: true }).last().click();
    await second.getByRole("menuitemradio", { name: "Agent", exact: true }).click();
    await expect(first.getByRole("region", { name: "Agent pane", exact: true })).toHaveCount(1);
    await expect(first.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect(second.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect(first.getByRole("log", { name: "Chat timeline" })).toBeEmpty();
    await first.getByRole("separator", { name: "Resize split" }).focus();
    await first.keyboard.press("ArrowRight");
    await expect(second.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-valuenow",
      "55",
    );
    await first.getByRole("button", { name: "Terminal", exact: true }).click({ button: "right" });
    await first.getByRole("menuitem", { name: "Rename tab", exact: true }).click();
    await first.getByLabel("Tab name", { exact: true }).fill("Build and review");
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      second.getByRole("button", { name: "Build and review", exact: true }),
    ).toBeVisible();
    await second.reload();
    await expect(second.getByRole("region", { name: "Agent pane", exact: true })).toHaveCount(1);
    await expect(second.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-valuenow",
      "55",
    );

    disconnected = true;
    for (const socket of sockets.splice(0)) socket.close();
    await expect(second.getByRole("button", { name: "New tab", exact: true })).toBeDisabled();
    await first.getByRole("button", { name: "New tab", exact: true }).click();
    await first.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    disconnected = false;
    await expect(second.getByRole("button", { name: "Terminal", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const tabs = first.getByLabel("Project tabs");
    await tabs
      .getByRole("button", { name: "Terminal", exact: true })
      .dragTo(tabs.getByRole("button", { name: "Build and review", exact: true }));
    await expect
      .poll(() =>
        second
          .getByLabel("Project tabs")
          .locator("[data-tab-id] > button:first-child")
          .allTextContents(),
      )
      .toEqual(["Terminal", "Build and review"]);
    await second.getByRole("button", { name: "Build and review", exact: true }).click();
    await expect(
      first.getByRole("button", { name: "Build and review", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await second.getByRole("button", { name: "Close pane", exact: true }).last().click();
    await expect(first.getByRole("region", { name: "Agent pane", exact: true })).toHaveCount(0);
    await expect(first.getByRole("region", { name: "Terminal pane", exact: true })).toHaveCount(1);
    await expect(first.getByRole("separator", { name: "Resize split" })).toHaveCount(0);

    await first.getByRole("button", { name: "Terminal", exact: true }).focus();
    await first.keyboard.press("Shift+F10");
    await first.getByRole("menuitem", { name: "Close tab", exact: true }).click();
    await expect(second.getByRole("button", { name: "Terminal", exact: true })).toHaveCount(0);

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
    await first.getByRole("button", { name: "Actions for Concors acceptance" }).click();
    await first.getByRole("menuitem", { name: "Remove project…" }).click();
    await expect(first.getByRole("dialog")).toContainText("Files on disk are kept.");
    await expect(first.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await first.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      first.getByRole("heading", { name: "Concors acceptance", exact: true }),
    ).toBeVisible();
    await first.getByRole("button", { name: "Actions for Concors acceptance" }).click();
    await first.getByRole("menuitem", { name: "Remove project…" }).click();
    await first
      .getByRole("dialog")
      .getByRole("button", { name: "Remove project", exact: true })
      .click();
    await expect(
      second.getByRole("heading", { name: "Your projects, in one place" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await otherDevice.close();
  }
});
