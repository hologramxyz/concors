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
it("connects using the machine contract when optional mobile capabilities are absent", async () => {
  const result = await inspectLivePrerequisites(api(), demoMachine.id);
  expect(result.readyToAttemptWorkspaceConnection).toBe(true);
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
    "This machine is provisioning.",
  );
});
