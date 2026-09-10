import type { ApiClient } from "@concors/api-client";
import { managedHost, ConnectionAccessError } from "@concors/client-core";

/** Read-only prerequisites, not a claim that a session or signed native build was tested. */
export async function inspectLivePrerequisites(
  api: Pick<ApiClient, "getMe" | "listMachines" | "getMobileCapabilities">,
  machineId: string,
) {
  const me = await api.getMe();
  const machines = await api.listMachines();
  const machine = machines.find((item) => item.id === machineId);
  if (!machine || machine.organizationId !== me.session.activeOrganizationId)
    throw new Error("The selected machine is not available in the account's active organization.");
  const capabilities = await api.getMobileCapabilities();
  const blockers: string[] = [];
  const paidPeriodEnded =
    machine.cancelledAt !== null &&
    (machine.paidUntil === null || !(Date.parse(machine.paidUntil) > Date.now()));
  if (machine.status !== "running" || paidPeriodEnded) blockers.push("The machine is not running.");
  if (!capabilities.remoteAccess)
    blockers.push(
      machine.agentInstalledAt
        ? "A machine agent is installed, but this deployment does not advertise the Concourse workspace/chat bridge. Terminal access alone is not workspace parity."
        : "The deployment does not advertise Concourse workspace access.",
    );
  if (capabilities.remoteAccess && !blockers.length) {
    try {
      managedHost(machine);
    } catch (cause) {
      blockers.push(
        cause instanceof ConnectionAccessError
          ? cause.message
          : "Managed connection metadata is invalid.",
      );
    }
  }
  return {
    authenticated: true,
    machineStatus: machine.status,
    agentInstalled: !!machine.agentInstalledAt,
    agentVersion: machine.agentVersion ?? null,
    agentLastSeen: machine.agentSeenAt ?? null,
    agentInstallFailed: !!machine.agentError,
    certificateExpiresAt: machine.certificateExpiresAt ?? null,
    advertised: capabilities,
    blockers,
    readyToAttemptWorkspaceConnection: blockers.length === 0,
    liveSessionVerified: false,
  };
}
