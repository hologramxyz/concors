import { describe, expect, it } from "vitest";
import { NotificationDeduplicator, notificationTarget, sessionHref } from "./notifications.ts";
const id = "11111111-1111-4111-8111-111111111111";
const target = {
  version: 1,
  eventId: id,
  userId: "alice",
  machineId: "machine/with spaces",
  projectId: id,
  sessionId: id,
};
describe("notification navigation", () => {
  it("rejects malformed payloads, arbitrary URLs, and another account's notification", () => {
    expect(notificationTarget({ url: "https://evil.example" }, "alice")).toBeNull();
    expect(notificationTarget(target, "bob")).toBeNull();
    expect(notificationTarget({ ...target, sessionId: "../settings" }, "alice")).toBeNull();
  });
  it("constructs an internal route from validated, encoded identities", () => {
    const parsed = notificationTarget(target, "alice");
    expect(parsed).not.toBeNull();
    expect(sessionHref(parsed!)).toContain("machineId=machine%2Fwith+spaces");
  });
  it("deduplicates delivery without growing forever", () => {
    const seen = new NotificationDeduplicator();
    expect(seen.accept("first")).toBe(true);
    expect(seen.accept("first")).toBe(false);
    for (let i = 0; i < 128; i++) seen.accept(String(i));
    expect(seen.accept("first")).toBe(true);
  });
});
