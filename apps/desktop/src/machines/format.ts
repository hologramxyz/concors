/**
 * Presentation helpers for cloud machines, kept free of React so they can be unit-tested and
 * reused by the settings sections.
 */
import type { Machine, MachineSize, MachineStatus, Money } from "@concors/api-client";

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
    case "deleted":
      return "Deleted";
    case "unknown":
      return "Busy";
  }
}

/**
 * The order failed before the provider took it: no server was ever created and nothing is billed.
 * Same rule as the server's `neverOrdered`, which lets these be removed outright.
 */
export function isUndeployed(machine: Pick<Machine, "status" | "orderId" | "serviceName">) {
  return machine.status === "error" && machine.orderId === null && machine.serviceName === null;
}

/**
 * Machines the server may still change on its own, including one installing a new daemon; the
 * list keeps polling while any exist.
 */
export function isSettling(machine: Pick<Machine, "status" | "daemonUpdate">): boolean {
  return (
    machine.status === "provisioning" ||
    machine.status === "unknown" ||
    machine.daemonUpdate?.installing === true
  );
}

/** `Ends Oct 8, 2026` for a cancelled machine, or `null` when it is not cancelled. */
export function describeEnding(
  machine: Pick<Machine, "cancelledAt" | "paidUntil">,
  locale?: string,
): string | null {
  if (machine.cancelledAt === null) return null;
  if (machine.paidUntil === null) return "Ends when the paid month is over";
  const date = new Date(machine.paidUntil);
  return Number.isNaN(date.getTime())
    ? "Ends when the paid month is over"
    : `Ends ${date.toLocaleDateString(locale, { dateStyle: "medium" })}`;
}

/**
 * `ssh ubuntu@1.2.3.4`, or `null` until the machine has an address and accepts logins. With
 * `identityPath` the command names this computer's Concors key, which `ssh` would not try by default.
 */
export function sshCommand(
  machine: Pick<Machine, "sshUser" | "ipv4" | "accessReadyAt" | "status">,
  identityPath?: string,
): string | null {
  if (machine.ipv4 === null || machine.accessReadyAt === null) return null;
  if (machine.status !== "running" && machine.status !== "stopped") return null;
  const identity = identityPath === undefined ? "" : `-i ${quotePath(identityPath)} `;
  return `ssh ${identity}${machine.sshUser}@${machine.ipv4}`;
}

/** Double quotes only when needed; they work in POSIX shells, PowerShell and cmd alike. */
function quotePath(path: string): string {
  return /^[\w./:~\\-]+$/.test(path) ? path : `"${path.replace(/"/g, '\\"')}"`;
}

/** The provider has none of this size left in the region right now. */
export function isSoldOut(size: MachineSize | undefined, region: string): boolean {
  return size?.soldOutRegions.includes(region) ?? false;
}

/** Nothing at all can be ordered in the region right now. */
export function isRegionSoldOut(sizes: readonly MachineSize[], region: string): boolean {
  return sizes.length > 0 && sizes.every((size) => isSoldOut(size, region));
}

/**
 * `current` when it can be ordered in `region`, otherwise the first size that can, so switching
 * region never leaves a sold-out size picked. Keeps `current` when every size is sold out.
 */
export function orderableSize(
  sizes: readonly MachineSize[],
  region: string,
  current: string,
): string {
  if (
    !isSoldOut(
      sizes.find((size) => size.id === current),
      region,
    )
  )
    return current;
  return sizes.find((size) => !isSoldOut(size, region))?.id ?? current;
}
