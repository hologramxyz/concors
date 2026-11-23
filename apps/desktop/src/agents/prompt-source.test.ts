import { expect, it } from "vitest";
import { promptSourceLabel } from "./prompt-source";

it("labels only user prompts, preferring their webhook source", () => {
  const trigger = { triggerId: "trigger", eventId: "event", source: "CI" };
  const origin = { supervisorId: "supervisor", deliveryId: "delivery" };
  expect(promptSourceLabel({ kind: "user", trigger })).toBe("From webhook · CI");
  expect(promptSourceLabel({ kind: "user", origin })).toBe("From Supervisor");
  expect(promptSourceLabel({ kind: "user", origin, trigger })).toBe("From webhook · CI");
  expect(promptSourceLabel({ kind: "user" })).toBeNull();
  expect(promptSourceLabel({ kind: "assistant", trigger, origin })).toBeNull();
});
