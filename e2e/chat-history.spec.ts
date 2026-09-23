import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { mockChatHistory } from "./support/chat-history.ts";

for (const width of [1360, 390]) {
  test(`chat automatically pages both ways with stable anchors at ${width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    const directory = await mkdtemp(join(tmpdir(), "concors-history-browser-"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const history = await mockChatHistory(page);
    try {
      await signedIn(page);
      await page.goto("/");
      await seedProject(page, "Infinite history", directory);
      await page.getByRole("button", { name: "New tab", exact: true }).click();
      await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
      const timeline = page.getByRole("log", { name: "Chat timeline" });
      await expect(timeline.getByText("History 0 message 639", { exact: true })).toBeVisible();
      if (width === 390) {
        await page.setViewportSize({ width, height: 844 });
        await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      }
      await expect(page.getByRole("button", { name: /Load (earlier|newer) messages/ })).toHaveCount(
        0,
      );
      const scrollToEdge = (edge: "top" | "bottom") =>
        timeline.evaluate((viewport, edge) => {
          // Only user input may leave the bottom; a bare scrollTop write reads as layout churn.
          viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: edge === "top" ? -1 : 1 }));
          viewport.scrollTop = edge === "top" ? 1 : viewport.scrollHeight;
          const top = viewport.getBoundingClientRect().top;
          const item = [...viewport.querySelectorAll<HTMLElement>("[data-message-id]")].find(
            (item) => item.getBoundingClientRect().bottom > top,
          );
          if (!item?.dataset.messageId) throw new Error("No visible message to anchor");
          return { id: item.dataset.messageId, offset: item.getBoundingClientRect().top - top };
        }, edge);
      const assertAnchor = async (anchor: { id: string; offset: number }) => {
        await expect
          .poll(() =>
            timeline.evaluate((viewport, anchor) => {
              const item = [...viewport.querySelectorAll<HTMLElement>("[data-message-id]")].find(
                (item) => item.dataset.messageId === anchor.id,
              );
              return item
                ? Math.abs(
                    item.getBoundingClientRect().top -
                      viewport.getBoundingClientRect().top -
                      anchor.offset,
                  )
                : Infinity;
            }, anchor),
          )
          .toBeLessThan(2);
      };
      for (let step = 0; step < 4; step++) {
        const release = history.pauseNext("earlier");
        const before = history.requests.length;
        const anchor = await scrollToEdge("top");
        await expect.poll(() => history.requests.length).toBe(before + 1);
        await timeline.evaluate((viewport) => viewport.dispatchEvent(new Event("scroll")));
        expect(history.requests).toHaveLength(before + 1);
        release();
        await expect(timeline.locator("[data-message-position]").first()).toHaveAttribute(
          "data-message-position",
          String(480 - step * 80),
        );
        await assertAnchor(anchor);
        expect(await timeline.locator("[data-message-id]").count()).toBeLessThanOrEqual(240);
      }
      history.append();
      await expect(timeline.getByText("History 0 message 640", { exact: true })).toHaveCount(0);
      const navigation = page.locator('nav[aria-label="Your messages"]');
      await expect(navigation.locator("button")).toHaveCount(641);
      const anchor = await scrollToEdge("bottom");
      await expect
        .poll(() => history.requests.some((request) => request.after !== undefined))
        .toBe(true);
      await expect(timeline.locator("[data-message-position]").last()).toHaveAttribute(
        "data-message-position",
        "559",
      );
      await assertAnchor(anchor);
      history.failNext("newer");
      await scrollToEdge("bottom");
      await expect(timeline.getByRole("alert")).toContainText("History temporarily unavailable");
      const failedCount = history.requests.length;
      await timeline.evaluate((viewport) => viewport.dispatchEvent(new Event("scroll")));
      expect(history.requests).toHaveLength(failedCount);
      await timeline.getByRole("button", { name: "Retry loading messages" }).click();
      await expect(timeline.getByRole("alert")).toHaveCount(0);
      await scrollToEdge("bottom");
      await expect(timeline.getByText("History 0 message 640", { exact: true })).toBeVisible();
      await scrollToEdge("top");
      await expect(timeline.getByText("History 0 message 640", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Latest", exact: true }).click();
      await expect(timeline.locator("[data-message-id]")).toHaveCount(80);
      await expect(timeline.getByText("History 0 message 640", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Latest", exact: true })).toHaveCount(0);
      // The merged navigator jumps across trimmed windows, on desktop and narrow panes.
      for (const position of [100, 640]) {
        if (width >= 640) {
          await expect(page.getByRole("button", { name: "Browse your messages" })).toBeHidden();
          await navigation.locator(`button[aria-label^="Message ${position + 1} of"]`).focus();
          await page.keyboard.press("Enter");
        } else {
          await page.getByRole("button", { name: "Browse your messages", exact: true }).click();
          await page
            .getByRole("dialog", { name: "Your messages", exact: true })
            .getByRole("button", {
              name: `${position + 1} History 0 message ${position}`,
              exact: true,
            })
            .click();
        }
        await expect(
          timeline.getByText(`History 0 message ${position}`, { exact: true }),
        ).toBeInViewport();
        expect(await timeline.locator("[data-message-id]").count()).toBeLessThanOrEqual(240);
        await expect(
          navigation.locator(`button[aria-label^="Message ${position + 1} of"]`),
        ).toHaveAttribute("aria-current", "location");
      }
      const release = history.pauseNext("earlier");
      await scrollToEdge("top");
      await expect(timeline.getByRole("status")).toContainText("Loading earlier messages");
      history.truncate();
      await expect(timeline.getByText("History 1 message 119", { exact: true })).toBeVisible();
      release();
      await expect(timeline.getByText(/History 0 message/)).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`infinite-history-${width}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
