import { useContext, useEffect, useState } from "react";
import type { DaemonConnection } from "@concors/daemon-client";
import { TerminalConnectionContext } from "@/terminal/connection-context";

/** Writes a folder inside `home` the way a shell does. A different machine has a different home. */
export function tildePath(path: string, home: string | null): string {
  const root = home?.replace(/[\\/]+$/, "");
  if (!root) return path;
  if (path === root) return "~";
  const separator = path[root.length];
  return path.startsWith(root) && (separator === "/" || separator === "\\")
    ? `~${path.slice(root.length)}`
    : path;
}

// Asked once per connection: every listed workspace wants it, and a machine's home does not move.
const homes = new WeakMap<DaemonConnection, Promise<string>>();

function machineHome(connection: DaemonConnection, epoch: string): Promise<string> {
  const known = homes.get(connection);
  if (known) return known;
  const asked = connection
    .requestProject({ kind: "browse", epoch, directory: "~" }, crypto.randomUUID())
    .then(({ outcome }) => {
      if (outcome.status !== "listed") throw new Error("The machine did not list its home.");
      return outcome.home;
    });
  homes.set(connection, asked);
  // Ask again next time; until an answer comes, paths simply show in full.
  asked.catch(() => homes.delete(connection));
  return asked;
}

/** Shortens paths on the connected machine with "~", once that machine has said where home is. */
export function useHomePath(): (path: string) => string {
  const connection = useContext(TerminalConnectionContext);
  const epoch = connection?.workspace?.epoch;
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    if (!connection || epoch === undefined) return;
    let cancelled = false;
    void machineHome(connection, epoch).then(
      (value) => {
        if (!cancelled) setHome(value);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [connection, epoch]);
  return (path) => tildePath(path, home);
}
