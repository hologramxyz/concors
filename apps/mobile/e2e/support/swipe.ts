import { expect, type Locator, type Page } from "@playwright/test";

/** Real touch input (including browser gesture arbitration), not synthetic pointer events. */
export async function swipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    for (let step = 1; step <= 10; step++)
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / 10,
            y: from.y + ((to.y - from.y) * step) / 10,
          },
        ],
      });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await client.detach();
  }
}

/**
 * Scrolls a chat timeline up with real input from the reader. A live chat stays pinned to its
 * latest message until then, and snaps back from a programmatic scroll such as Playwright's own
 * scroll into view. The wheel stands in for a finger: the chat counts both as the reader's, and
 * a synthesized touch scroll never took the timeline away from the bottom on the Linux runner.
 */
export async function scrollTimelineUp(page: Page, timeline: Locator, distance = 300) {
  const box = await timeline.boundingBox();
  if (!box) throw new Error("Chat timeline is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -distance);
  await expect
    .poll(() =>
      timeline.evaluate(
        (viewport) => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
      ),
    )
    .toBeGreaterThan(distance / 2);
}
