import { openFolder } from "./support/projects.ts";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

test("GitHub clone images fall back cleanly and project hover spans the action buttons", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-sidebar-"));
  let missingImage = false;
  try {
    await signedIn(page);
    await page.route("https://opengraph.githubassets.com/**", (route) =>
      route.fulfill(
        missingImage
          ? { status: 404, body: "" }
          : {
              contentType: "image/svg+xml",
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#447744"/></svg>',
            },
      ),
    );
    await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
      const server = socket.connectToServer();
      server.onMessage((raw) => {
        const event = JSON.parse(String(raw));
        if (event.type === "project.setups") {
          // The real clone lifecycle is tested separately; supply GitHub metadata without a network clone.
          for (const setup of event.setups)
            if (setup.name === "Sidebar images") {
              setup.mode = "clone";
              setup.repository = "git@github.com:concors-dev/concors.git";
            }
        }
        socket.send(JSON.stringify(event));
      });
    });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const name of ["Sidebar images", "Local sidebar"]) {
      await mkdir(join(directory, name));
      await openFolder(page, join(directory, name));
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    const row = nav.getByRole("button", { name: "Sidebar images", exact: true }).locator("..");
    await expect(row.locator("img")).toBeVisible();
    await expect(row.locator("img")).toHaveAttribute(
      "src",
      "https://opengraph.githubassets.com/1/concors-dev/concors",
    );
    await expect(
      nav.getByRole("button", { name: "Local sidebar", exact: true }).locator("img"),
    ).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect(row).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await row.getByRole("button", { name: "Actions for Sidebar images" }).hover();
    const hovered = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(hovered).not.toBe("rgba(0, 0, 0, 0)");
    await row.getByRole("button", { name: "Sidebar images", exact: true }).hover();
    await expect(row).toHaveCSS("background-color", hovered);
    const add = nav.getByRole("button", { name: "Open workspace menu", exact: true });
    const header = add.locator("../..");
    await add.hover();
    await expect(header).toHaveCSS("background-color", hovered);
    await nav.getByRole("button", { name: "Workspaces", exact: true }).hover();
    await expect(header).toHaveCSS("background-color", hovered);
    missingImage = true;
    await page.reload();
    await expect(row.locator("svg.lucide-folder")).toBeVisible();
    await expect(row.locator("img")).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
