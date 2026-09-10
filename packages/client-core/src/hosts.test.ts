import { expect, it } from "vitest";
import { machineStatusLabel } from "./hosts.ts";

it("distinguishes online availability from this device's actual connection", () => {
  for (const [availability, label] of [
    ["connectable", "Online"],
    ["provisioning", "Provisioning"],
    ["offline", "Offline"],
  ] as const) {
    expect(machineStatusLabel(availability)).toBe(label);
    expect(machineStatusLabel(availability, false)).toBe(label);
    expect(machineStatusLabel(availability, true)).toBe("Connected");
  }
});
