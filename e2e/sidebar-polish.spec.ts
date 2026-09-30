import { openFolder } from "./support/projects.ts";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";

test("GitHub clones show their folder's icon rather than a remote image, and project hover spans the action buttons", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-sidebar-"));
  // Sidebar icons come from the folder itself (a favicon or a repository initial, covered by
  // workspace-icons.spec.ts), so a GitHub clone must not load GitHub's preview image.
  const remoteImages: string[] = [];
  try {
    await signedIn(page);
    await page.route("https://opengraph.githubassets.com/**", (route) => {
      remoteImages.push(route.request().url());
      return route.fulfill({ status: 404, body: "" });
    });
    await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
      const server = socket.connectToServer();
      server.onMessage((raw) => {
        const event = JSON.parse(String(raw));
        if (event.type === "project.setups") {
          // The real clone lifecycle is tested separately; supply GitHub metadata without a network clone.
          for (const setup of event.setups)
            if (setup.name === "Sidebar images") {
              setup.mode = "clone";
              setup.repository = "git@github.com:hologramxyz/concors.git";
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
    for (const name of ["Sidebar images", "Local sidebar"]) {
      const button = nav.getByRole("button", { name, exact: true });
      await expect(button.locator('[data-project-icon="folder"] svg.lucide-folder')).toBeVisible();
      await expect(button.locator("img")).toHaveCount(0);
    }
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
    await page.reload();
    await expect(row.locator("svg.lucide-folder")).toBeVisible();
    await expect(row.locator("img")).toHaveCount(0);
    expect(remoteImages).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
