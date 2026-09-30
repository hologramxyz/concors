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
 * A finger dragging a scroller, which the browser scrolls natively. Raw touch events above
 * reach page handlers but never scroll; a positive distance reveals content above.
 */
export async function touchScroll(page: Page, from: { x: number; y: number }, distance: number) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Input.synthesizeScrollGesture", {
      x: Math.round(from.x),
      y: Math.round(from.y),
      yDistance: distance,
      gestureSourceType: "touch",
      speed: 2000,
    });
  } finally {
    await client.detach();
  }
}

/**
 * Scrolls a chat timeline up the way a reader does. A live chat stays pinned to its latest
 * message until then, and snaps back from a programmatic scroll such as Playwright's own.
 */
export async function scrollTimelineUp(page: Page, timeline: Locator, distance = 300) {
  const fromBottom = () =>
    timeline.evaluate(
      (viewport) => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
    );
  // On a CI runner the first gesture right after the chat opens can leave it at the bottom, so
  // scroll again until the reader has stayed away from the bottom.
  await expect(async () => {
    const box = await timeline.boundingBox();
    if (!box) throw new Error("Chat timeline is not visible");
    await touchScroll(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, distance);
    // Past the moment the chat decides whether the finger left it following the bottom.
    await page.waitForTimeout(500);
    expect(await fromBottom()).toBeGreaterThan(distance / 2);
  }).toPass({ timeout: 15_000 });
}
