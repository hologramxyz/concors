import { describe, expect, it } from "vitest";

import { describePaymentFailure } from "./payment-failure.ts";

const FAILED_AT = "2026-09-18T10:00:00.000Z";

describe("describePaymentFailure", () => {
  it("says nothing while the card works", () => {
    expect(describePaymentFailure(null, 3)).toBeNull();
  });

  it("names the number of machines and warns that deletion is permanent", () => {
    const warning = describePaymentFailure(FAILED_AT, 3, "en-US");
    expect(warning?.title).toBe("Payment failed — your machines will be deleted");
    expect(warning?.detail).toContain("Sep 18, 2026");
    expect(warning?.detail).toContain("all 3 of your machines will be permanently deleted");
    expect(warning?.detail).toContain("cannot be undone");
  });

  it("reads as one machine in the singular", () => {
    const warning = describePaymentFailure(FAILED_AT, 1, "en-US");
    expect(warning?.detail).toContain("your machine will be permanently deleted");
    expect(warning?.detail).toContain("everything on it.");
  });

  it("drops the deletion threat when there is nothing to delete", () => {
    const warning = describePaymentFailure(FAILED_AT, 0, "en-US");
    expect(warning?.title).toBe("Payment failed");
    expect(warning?.detail).not.toContain("deleted");
  });

  it("stays plural when the caller cannot count the machines", () => {
    const warning = describePaymentFailure(FAILED_AT, null, "en-US");
    expect(warning?.detail).toContain("your machines will be permanently deleted");
  });

  // The date comes from the server; a bad one must not put "Invalid Date" in front of the user.
  it("omits the day rather than printing a broken date", () => {
    const warning = describePaymentFailure("not-a-date", 2, "en-US");
    expect(warning?.detail).toContain("We couldn’t charge your card.");
    expect(warning?.detail).not.toContain("Invalid");
  });
});
