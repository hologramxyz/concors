import { describe, expect, it } from "vitest";

import {
  describeEnding,
  describeStatus,
  formatMoney,
  formatMonthly,
  isExternal,
  isRelayed,
  isSettling,
  isRegionSoldOut,
  isSoldOut,
  isUndeployed,
  isValidMachineName,
  orderableSize,
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
    expect(isSettling({ status: "unknown" })).toBe(true);
    expect(isSettling({ status: "running" })).toBe(false);
    expect(isSettling({ status: "error" })).toBe(false);
    const update = { version: "0.7.0", installing: false };
    expect(isSettling({ status: "running", daemonUpdate: update })).toBe(false);
    expect(isSettling({ status: "running", daemonUpdate: { ...update, installing: true } })).toBe(
      true,
    );
    expect(isSettling({ status: "running", daemonUpdate: null })).toBe(false);
  });

  it("says when a cancelled machine ends", () => {
    expect(describeEnding({ cancelledAt: null, paidUntil: "2026-10-08T21:01:42.000Z" })).toBeNull();
    expect(
      describeEnding(
        { cancelledAt: "2026-09-08T22:10:55.773Z", paidUntil: "2026-10-08T21:01:42.000Z" },
        "en-US",
      ),
    ).toBe("Ends Oct 8, 2026");
    expect(describeEnding({ cancelledAt: "2026-09-08T22:10:55.773Z", paidUntil: null })).toBe(
      "Ends when the paid month is over",
    );
  });
});

describe("sshCommand", () => {
  it("is available once the machine has an address and accepts logins", () => {
    expect(sshCommand(READY)).toBe("ssh ubuntu@147.135.1.2");
    expect(sshCommand({ ...READY, accessReadyAt: null })).toBeNull();
    expect(sshCommand({ ...READY, ipv4: null })).toBeNull();
    // Through the relay there is no address this computer can reach.
    expect(sshCommand({ ...READY, connection: "relay" })).toBeNull();
    expect(isRelayed({ connection: "relay" })).toBe(true);
    expect(isRelayed({ connection: "direct" })).toBe(false);
    expect(isRelayed({})).toBe(false);
    expect(sshCommand({ ...READY, status: "provisioning" })).toBeNull();
  });

  it("names this computer's key so ssh uses it", () => {
    expect(sshCommand(READY, "/home/ada/.ssh/concors_ed25519")).toBe(
      "ssh -i /home/ada/.ssh/concors_ed25519 ubuntu@147.135.1.2",
    );
    expect(sshCommand(READY, "C:\\Users\\Ada\\.ssh\\concors_ed25519")).toBe(
      "ssh -i C:\\Users\\Ada\\.ssh\\concors_ed25519 ubuntu@147.135.1.2",
    );
  });

  it("quotes a key path that a shell would split", () => {
    expect(sshCommand(READY, "/Users/Ada Lovelace/.ssh/concors_ed25519")).toBe(
      'ssh -i "/Users/Ada Lovelace/.ssh/concors_ed25519" ubuntu@147.135.1.2',
    );
    expect(sshCommand({ ...READY, accessReadyAt: null }, "/k")).toBeNull();
    expect(sshCommand({ ...READY, status: "stopped" })).toBe("ssh ubuntu@147.135.1.2");
  });
});

describe("sold-out sizes", () => {
  const size = (id: string, soldOutRegions: string[]) => ({
    id,
    vcpus: 2,
    ramGb: 4,
    diskGb: 40,
    monthlyPrice: null,
    soldOutRegions,
  });
  const sizes = [
    size("small", []),
    size("large", ["US-WEST-OR"]),
    size("xlarge", ["US-WEST-OR", "US-EAST-VA"]),
  ];

  it("is sold out only in the listed regions", () => {
    expect(isSoldOut(sizes[1], "US-WEST-OR")).toBe(true);
    expect(isSoldOut(sizes[1], "US-EAST-VA")).toBe(false);
    expect(isSoldOut(undefined, "US-WEST-OR")).toBe(false);
  });

  it("calls a region sold out only when no size is left", () => {
    expect(isRegionSoldOut(sizes, "US-WEST-OR")).toBe(false);
    expect(isRegionSoldOut([sizes[2]!], "US-WEST-OR")).toBe(true);
    expect(isRegionSoldOut([], "US-WEST-OR")).toBe(false);
  });

  it("keeps an orderable size and replaces a sold-out one", () => {
    expect(orderableSize(sizes, "US-EAST-VA", "large")).toBe("large");
    expect(orderableSize(sizes, "US-WEST-OR", "large")).toBe("small");
    expect(orderableSize(sizes, "US-EAST-VA", "xlarge")).toBe("small");
  });

  it("keeps the choice when nothing can be ordered", () => {
    expect(orderableSize([sizes[2]!], "US-WEST-OR", "xlarge")).toBe("xlarge");
  });
});

describe("isUndeployed", () => {
  const failed = { status: "error", orderId: null, serviceName: null } as const;

  it("only matches failed machines that never got an order or a server", () => {
    expect(isUndeployed(failed)).toBe(true);
    expect(isUndeployed({ ...failed, orderId: "777" })).toBe(false);
    expect(isUndeployed({ ...failed, serviceName: "vps-1.vps.ovh.us" })).toBe(false);
    expect(isUndeployed({ ...failed, status: "provisioning" })).toBe(false);
  });

  it("never matches the person's own server, which has no order to fail", () => {
    expect(isUndeployed({ ...failed, provider: "external" })).toBe(false);
  });
});

describe("own servers", () => {
  const waiting = {
    status: "provisioning",
    ovhState: null,
    serviceName: null,
    provider: "external",
  } as const;

  it("are told apart from VPS, including on control planes without providers", () => {
    expect(isExternal(waiting)).toBe(true);
    expect(isExternal({ provider: "ovh" })).toBe(false);
    expect(isExternal({})).toBe(false);
  });

  it("wait for the server rather than an order", () => {
    expect(describeStatus(waiting)).toBe("Waiting for server");
    expect(describeStatus({ ...waiting, status: "running" })).toBe("Running");
  });
});
