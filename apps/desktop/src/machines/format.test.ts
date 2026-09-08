import { describe, expect, it } from "vitest";

import {
  describeStatus,
  formatMoney,
  formatMonthly,
  isSettling,
  isValidMachineName,
  sshCommand,
} from "./format.ts";

const READY = {
  status: "running",
  ovhState: "running",
  serviceName: "vps-1.vps.ovh.us",
  sshUser: "ubuntu",
  ipv4: "147.135.1.2",
  accessReadyAt: "2026-09-07T22:00:00.000Z",
} as const;

describe("machine names", () => {
  it("accepts DNS-label style names and rejects the rest", () => {
    expect(isValidMachineName("build-agent-1")).toBe(true);
    expect(isValidMachineName("a")).toBe(true);
    expect(isValidMachineName("Agent")).toBe(false);
    expect(isValidMachineName("-agent")).toBe(false);
    expect(isValidMachineName("agent-")).toBe(false);
    expect(isValidMachineName("")).toBe(false);
    expect(isValidMachineName("a".repeat(64))).toBe(false);
  });
});

describe("money", () => {
  it("formats in the given locale and falls back for unknown currencies", () => {
    expect(formatMoney({ amount: 6.99, currency: "USD" }, "en-US")).toBe("$6.99");
    expect(formatMonthly({ amount: 6.99, currency: "USD" }, "en-US")).toBe("$6.99/month");
    expect(formatMoney(null)).toBe("—");
    expect(formatMonthly(null)).toBe("—");
    expect(formatMoney({ amount: 1, currency: "NOPE" }, "en-US")).toBe("1.00 NOPE");
  });
});

describe("status", () => {
  it("explains what a provisioning machine is waiting on", () => {
    expect(
      describeStatus({ status: "provisioning", ovhState: "order:checking", serviceName: null }),
    ).toBe("Ordering server");
    expect(
      describeStatus({
        status: "provisioning",
        ovhState: "order:documentsRequested",
        serviceName: null,
      }),
    ).toBe("Waiting for OVH review");
    expect(
      describeStatus({ status: "provisioning", ovhState: "running", serviceName: "vps-1" }),
    ).toBe("Installing");
    expect(describeStatus(READY)).toBe("Running");
    expect(describeStatus({ ...READY, status: "unknown" })).toBe("Busy");
  });

  it("keeps polling only while the server may still change the machine", () => {
    expect(isSettling({ status: "provisioning" })).toBe(true);
    expect(isSettling({ status: "deleting" })).toBe(true);
    expect(isSettling({ status: "running" })).toBe(false);
    expect(isSettling({ status: "error" })).toBe(false);
  });
});

describe("sshCommand", () => {
  it("is available once the machine has an address and accepts logins", () => {
    expect(sshCommand(READY)).toBe("ssh ubuntu@147.135.1.2");
    expect(sshCommand({ ...READY, accessReadyAt: null })).toBeNull();
    expect(sshCommand({ ...READY, ipv4: null })).toBeNull();
    expect(sshCommand({ ...READY, status: "provisioning" })).toBeNull();
    expect(sshCommand({ ...READY, status: "stopped" })).toBe("ssh ubuntu@147.135.1.2");
  });
});
