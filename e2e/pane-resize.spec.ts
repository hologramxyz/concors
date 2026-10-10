import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";

test("dragging a split follows the pointer, selects no text and does not snap back", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "concors-pane-resize-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A cloud machine answers over the network; hold every daemon message back to show that.
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => setTimeout(() => socket.send(message), 400));
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Resize", directory);
    await page.getByRole("button", { name: "Pane actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Split horizontally", exact: true }).click();
    const handle = page.getByRole("separator", { name: "Resize split" });
    await expect(handle).toHaveAttribute("aria-valuenow", "50");
    const box = await handle.boundingBox();
    if (!box) throw new Error("No split handle");
    const centre = () => handle.boundingBox().then((b) => (b ? b.x + b.width / 2 : Number.NaN));

    // Press just beside the narrow gap, off its centre, and drag across the right-hand pane.
    const y = box.y + box.height / 2;
    const offset = box.width / 2 + 3;
    const start = box.x + box.width / 2 + offset;
    await page.mouse.move(start, y);
    await page.mouse.down();
    await expect(page.locator("html")).toHaveAttribute("data-pane-resizing", "column");
    expect(Math.abs((await centre()) - (start - offset))).toBeLessThanOrEqual(1);
    await page.mouse.move(start + 150, y, { steps: 10 });
    await expect
      .poll(async () => Math.abs((await centre()) - (start + 150 - offset)))
      .toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    const dragged = await handle.getAttribute("aria-valuenow");
    expect(Number(dragged)).toBeGreaterThan(50);

    // Released, the split stays put while the daemon's answer is still on its way.
    await page.mouse.up();
    await expect(page.locator("html")).not.toHaveAttribute("data-pane-resizing");
    // Sampled without retrying: a snap back and forth would pass a waiting assertion.
    const seen = await handle.evaluate(async (element) => {
      const values = new Set<string | null>();
      const end = performance.now() + 900;
      while (performance.now() < end) {
        values.add(element.getAttribute("aria-valuenow"));
        await new Promise(requestAnimationFrame);
      }
      return [...values];
    });
    expect(seen).toEqual([dragged]);
    await page.reload();
    await expect(page.getByRole("separator", { name: "Resize split" })).toHaveAttribute(
      "aria-valuenow",
      dragged ?? "",
    );
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
