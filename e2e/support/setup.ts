import type { Page } from "@playwright/test";

const SETUP_KEY = "concors.setup.v1";

/**
 * Every spec starts on a fresh device, where first-run setup would cover the app it drives.
 * Marks setup as already skipped, unless a spec decided otherwise before this runs.
 */
export async function skipSetup(page: Page) {
  await page.addInitScript((key) => {
    if (window === window.top && localStorage.getItem(key) === null)
      localStorage.setItem(key, JSON.stringify({ status: "done", outcome: "skipped" }));
  }, SETUP_KEY);
}
