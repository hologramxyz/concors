/**
 * Presentation helpers for cloud machines, kept free of React so they can be unit-tested and
 * reused by the settings sections.
 */
import type { Machine, MachineStatus, Money } from "@concors/api-client";

/** Same rule as the server's `machineNameSchema`: lowercase DNS label, up to 63 characters. */
export const MACHINE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const MACHINE_NAME_MAX_LENGTH = 63;

export function isValidMachineName(name: string): boolean {
  return name.length <= MACHINE_NAME_MAX_LENGTH && MACHINE_NAME_PATTERN.test(name);
}

/** `$6.99` / `6,99 €` in the user's locale; `"—"` when the price is unknown. */
export function formatMoney(money: Money | null, locale?: string): string {
  if (money === null) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: money.currency }).format(
      money.amount,
    );
  } catch {
    return `${money.amount.toFixed(2)} ${money.currency}`;
  }
}

export function formatMonthly(money: Money | null, locale?: string): string {
  return money === null ? "—" : `${formatMoney(money, locale)}/month`;
}

export type StatusTone = "neutral" | "pending" | "success" | "danger";

export const STATUS_TONE: Record<MachineStatus, StatusTone> = {
  provisioning: "pending",
  running: "success",
  stopped: "neutral",
  error: "danger",
  deleting: "pending",
  deleted: "neutral",
  unknown: "neutral",
};

/** Short, human status. `provisioning` is refined with what the server is waiting on. */
export function describeStatus(machine: Pick<Machine, "status" | "ovhState" | "serviceName">) {
  switch (machine.status) {
    case "provisioning":
      if (machine.ovhState === "order:documentsRequested") return "Waiting for OVH review";
      if (machine.ovhState?.startsWith("order:")) return "Ordering server";
      if (machine.serviceName === null) return "Provisioning";
      return "Installing";
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
    case "deleting":
      return "Deleting";
    case "deleted":
      return "Deleted";
    case "unknown":
      return "Busy";
  }
}

/** Machines the server may still change on its own; the list keeps polling while any exist. */
export function isSettling(machine: Pick<Machine, "status">): boolean {
  return (
    machine.status === "provisioning" ||
    machine.status === "deleting" ||
    machine.status === "unknown"
  );
}

/** `ssh ubuntu@1.2.3.4`, or `null` until the machine has an address and accepts logins. */
export function sshCommand(
  machine: Pick<Machine, "sshUser" | "ipv4" | "accessReadyAt" | "status">,
): string | null {
  if (machine.ipv4 === null || machine.accessReadyAt === null) return null;
  if (machine.status !== "running" && machine.status !== "stopped") return null;
  return `ssh ${machine.sshUser}@${machine.ipv4}`;
}
