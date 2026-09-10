import { expect, it, vi } from "vitest";
import { NO_MOBILE_CAPABILITIES } from "@concors/api-client";
import { demoMe, demoMachine } from "./demo/fixtures";
import { inspectLivePrerequisites } from "./live-preflight";

function api() {
  const machine = {
    ...demoMachine,
    hostname: "m-test.concors.app",
    agentSeenAt: new Date().toISOString(),
    agentVersion: "0.2.0",
    certificateExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
  };
  return {
    getMe: vi.fn(async () => demoMe),
    listMachines: vi.fn(async () => [machine as typeof demoMachine]),
    getMobileCapabilities: vi.fn(async () => ({ ...NO_MOBILE_CAPABILITIES })),
  };
}
it("never mistakes an installed terminal agent for Concourse chat support", async () => {
  const client = api();
  client.listMachines.mockResolvedValue([
    { ...demoMachine, agentInstalledAt: "2026-09-09T00:00:00.000Z" },
  ]);
  const result = await inspectLivePrerequisites(client, demoMachine.id);
  expect(result.readyToAttemptWorkspaceConnection).toBe(false);
  expect(result.blockers.join(" ")).toContain("workspace/chat bridge");
  expect(result.liveSessionVerified).toBe(false);
});
it("fails closed on missing machines, other organizations and authentication errors", async () => {
  const client = api();
  await expect(inspectLivePrerequisites(client, "other")).rejects.toThrow("not available");
  client.listMachines.mockResolvedValue([{ ...demoMachine, organizationId: "other-org" }]);
  await expect(inspectLivePrerequisites(client, demoMachine.id)).rejects.toThrow("not available");
  client.getMe.mockRejectedValue(new Error("unauthorized"));
  await expect(inspectLivePrerequisites(client, demoMachine.id)).rejects.toThrow("unauthorized");
});
it("reports advertised prerequisites without claiming an end-to-end connection", async () => {
  const client = api();
  client.getMobileCapabilities.mockResolvedValue({ ...NO_MOBILE_CAPABILITIES, remoteAccess: true });
  const result = await inspectLivePrerequisites(client, demoMachine.id);
  expect(result.readyToAttemptWorkspaceConnection).toBe(true);
  expect(result.liveSessionVerified).toBe(false);
  client.listMachines.mockResolvedValue([{ ...demoMachine, status: "provisioning" }]);
  expect((await inspectLivePrerequisites(client, demoMachine.id)).blockers).toContain(
    "The machine is not running.",
  );
});
it("only treats a cancelled machine as available while its paid period remains active", async () => {
  const client = api();
  const readyMachine = (await client.listMachines())[0]!;
  client.getMobileCapabilities.mockResolvedValue({ ...NO_MOBILE_CAPABILITIES, remoteAccess: true });
  for (const paidUntil of [null, "invalid", "2000-01-01T00:00:00.000Z"]) {
    client.listMachines.mockResolvedValue([
      { ...demoMachine, cancelledAt: "2026-09-01T00:00:00.000Z", paidUntil },
    ]);
    expect((await inspectLivePrerequisites(client, demoMachine.id)).blockers).toContain(
      "The machine is not running.",
    );
  }
  client.listMachines.mockResolvedValue([
    {
      ...readyMachine,
      cancelledAt: "2026-09-01T00:00:00.000Z",
      paidUntil: new Date(Date.now() + 60_000).toISOString(),
    },
  ]);
  expect((await inspectLivePrerequisites(client, demoMachine.id)).blockers).toEqual([]);
});
