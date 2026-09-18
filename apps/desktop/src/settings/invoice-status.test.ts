import { describe, expect, it } from "vitest";

import { describeInvoiceStatus } from "./invoice-status";

describe("invoice status presentation", () => {
  it.each([
    ["paid", "Paid", "emerald"],
    ["open", "Open", "sky"],
    ["pending", "Pending", "amber"],
    ["past_due", "Past due", "destructive"],
    ["uncollectible", "Uncollectible", "destructive"],
    ["draft", "Draft", "muted"],
    ["void", "Void", "muted"],
  ])("formats %s as %s with its semantic tone", (status, label, tone) => {
    const presentation = describeInvoiceStatus(status);
    expect(presentation.label).toBe(label);
    expect(presentation.className).toContain(tone);
  });

  it("keeps unknown and missing states readable and neutral", () => {
    expect(describeInvoiceStatus("requires_action")).toMatchObject({
      label: "Requires action",
      className: expect.stringContaining("muted"),
    });
    expect(describeInvoiceStatus(null)).toMatchObject({
      label: "Unknown",
      className: expect.stringContaining("muted"),
    });
  });
});
