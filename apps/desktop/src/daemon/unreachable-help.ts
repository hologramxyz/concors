/**
 * What to tell someone whose machine Concors cannot reach, and how they can find out why. The app
 * keeps retrying on its own; this explains the wait instead of leaving only an error. A machine's
 * last heartbeat to Concors tells "running but out of reach from here" (the network) apart from
 * "not answering anyone" (off, restarting, or out of memory).
 */
export interface UnreachableMachine {
  kind: "local" | "concors" | "own";
  /** Through the Concors relay: an own server the internet cannot reach directly. */
  relayed: boolean;
  /** Milliseconds since its last heartbeat to Concors; null when unknown. */
  seenAgo: number | null;
}

export interface UnreachableHelp {
  status: string | null;
  causes: string[];
  /** Commands to run on the machine, for an own server. */
  commands: string | null;
}

/** A heartbeat comes every 30 s; two minutes of silence means the daemon is not running. */
const RECENT_MS = 2 * 60_000;

export function unreachableHelp(machine: UnreachableMachine): UnreachableHelp {
  if (machine.kind === "local")
    return {
      status: null,
      causes: [
        "Concors's service on this computer stopped or is restarting.",
        "Quit Concors and open it again. Your terminals and agents keep running.",
      ],
      commands: null,
    };
  const status =
    machine.seenAgo === null
      ? null
      : machine.seenAgo <= RECENT_MS
        ? "The machine is running: it checked in with Concors moments ago. Something between this device and the machine is blocking the connection."
        : `The machine has not checked in with Concors for ${duration(machine.seenAgo)}. It is probably off, restarting, or out of memory.`;
  if (machine.kind === "concors")
    return {
      status,
      causes: [
        "It may be restarting or installing an update, which happens only while no agent is working. It is usually back within a couple of minutes.",
        "If it stays unreachable, open Machines in Settings to check on it or restart it.",
      ],
      commands: null,
    };
  return {
    status,
    causes: [
      "The server is off or restarting.",
      "It ran out of memory. Coding agents use a lot, and a small server can run out and stop Concors's service.",
      machine.relayed
        ? "Its tunnel to the Concors relay dropped, or its network blocks outgoing connections."
        : "A firewall, or the provider's network, blocks the connection to port 443.",
    ],
    commands: [
      "systemctl status concors-gateway concors-session-host --no-pager",
      ...(machine.relayed ? ["systemctl status concors-tunnel --no-pager"] : []),
      "journalctl -u concors-gateway -u concors-session-host --since '1 hour ago' --no-pager | tail -100",
      "free -m",
      "sudo dmesg -T | grep -iE 'out of memory|killed process' | tail",
    ].join("\n"),
  };
}

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${Math.round(hours / 24)} days`;
}
