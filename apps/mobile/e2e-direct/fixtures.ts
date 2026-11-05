import { expect, test as base } from "@playwright/test";

interface AISharing {
  allow: boolean;
  disclosures: string[];
}

/** Existing workspace acceptance cases explicitly consent to their fixture AI provider. Tests
 * covering refusal can change the choice; no application flag bypasses the permission boundary. */
export const test = base.extend<{ aiSharing: AISharing }>({
  // Playwright requires destructuring to identify fixture dependencies, including none.
  // eslint-disable-next-line no-empty-pattern
  aiSharing: async ({}, use) => {
    await use({ allow: true, disclosures: [] });
  },
  page: async ({ page, aiSharing }, use) => {
    page.on("dialog", async (dialog) => {
      if (dialog.type() === "confirm" && dialog.message().startsWith("Allow AI data sharing?")) {
        expect(dialog.message()).toContain("Recipients:");
        expect(dialog.message()).toContain("retention");
        aiSharing.disclosures.push(dialog.message());
        if (aiSharing.allow) await dialog.accept();
        else await dialog.dismiss();
      } else await dialog.dismiss();
    });
    await use(page);
  },
});

export { expect };
