import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps draft store copy within metadata limits without reviewer credentials", () => {
  const listing = JSON.parse(
    readFileSync(new URL("../release/store-listing.json", import.meta.url), "utf8"),
  );
  for (const [key, maximum] of [
    ["name", 30],
    ["iosSubtitle", 30],
    ["androidShortDescription", 80],
    ["description", 4000],
    ["iosKeywords", 100],
  ]) {
    expect(listing[key].length).toBeGreaterThan(0);
    expect(listing[key].length).toBeLessThanOrEqual(maximum);
  }
  expect(listing.status).toBe("draft-needs-owner-approval");
  expect(listing.reviewerCredentials).toBeNull();
});
