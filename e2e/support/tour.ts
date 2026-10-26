import type { Page } from "@playwright/test";

const TOUR_KEY = "concors.tour";

/**
 * Every spec starts on a fresh device, where the first-run tour would cover the app it drives.
 * Marks the tour as already skipped, unless a spec decided otherwise before this runs.
 */
export async function skipTour(page: Page) {
  await page.addInitScript((key) => {
    if (window === window.top && localStorage.getItem(key) === null)
      localStorage.setItem(key, JSON.stringify({ outcome: "skipped" }));
  }, TOUR_KEY);
}
