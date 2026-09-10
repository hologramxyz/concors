import { useState } from "react";
import { machineAvailability, type MobileState } from "@concors/client-core";
import { Button } from "@/components/ui/button";
import { Section } from "@/views/settings-primitives";
import { hostAction } from "./bridge";

/** Companion v1: access existing machines; no commerce or provisioning entry points. */
export function ExistingMachines({
  host,
  onConnected,
}: {
  host: MobileState;
  onConnected(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (id?: string) => {
    setBusy(true);
    setError(null);
    try {
      await hostAction(id ? { kind: "select-machine", machineId: id } : { kind: "refresh" });
      if (id) onConnected();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open machine");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 p-4">
      <Section title="Machines" description="Existing machines in your active organization.">
        {error && (
          <p role="alert" className="py-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {!host.machines.length && (
          <p className="py-4 text-sm text-muted-foreground">
            No machines are available in this organization. Switch organizations or refresh to check
            again.
          </p>
        )}
        <ul className="divide-y">
          {host.machines.map((machine) => (
            <li key={machine.id} className="flex items-center gap-3 py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{machine.name}</p>
                <p className="text-sm text-muted-foreground">{machineAvailability(machine)}</p>
              </div>
              <Button
                variant="outline"
                disabled={
                  busy ||
                  machineAvailability(machine) !== "connectable" ||
                  !host.capabilities.remoteAccess
                }
                onClick={() => void run(machine.id)}
              >
                {host.machineId === machine.id ? "Open" : "Connect"}
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="outline" disabled={busy} onClick={() => void run()}>
          Refresh machines
        </Button>
      </Section>
    </div>
  );
}
