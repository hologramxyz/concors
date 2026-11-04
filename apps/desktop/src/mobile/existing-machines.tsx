import { useState } from "react";
import { machineAvailability, machineStatusLabel, type MobileState } from "@concors/client-core";
import { Button } from "@/components/ui/button";
import { DaemonDetails, type DaemonConnectionInfo } from "@/machines/daemon-details";
import { MachinesEmptyState, MachinesRefreshButton } from "@/machines/machines-view";
import { Section } from "@/views/settings-primitives";
import { hostAction } from "./bridge";
import { api } from "@/auth/api";
import { MachineIconPicker } from "@/machines/machine-icon-picker";
import { RenameMachineDialog } from "@/machines/rename-machine-dialog";

/** Companion v1: access existing machines; no commerce or provisioning entry points. */
export function ExistingMachines({
  host,
  connection,
  onConnected,
}: {
  host: MobileState;
  /** The daemon of `host.machineId`, the machine this device is connected to. */
  connection: DaemonConnectionInfo;
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
  const connected = host.machines.find((machine) => machine.id === host.machineId);
  return (
    <div className="space-y-4 p-4">
      <Section
        title="Machines"
        actions={
          host.machines.length > 0 && (
            <MachinesRefreshButton busy={busy} onRefresh={() => void run()} />
          )
        }
      >
        {error && (
          <p role="alert" className="py-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {!host.machines.length && (
          <MachinesEmptyState>
            <Button variant="outline" disabled={busy} onClick={() => void run()}>
              Refresh
            </Button>
          </MachinesEmptyState>
        )}
        <ul className="divide-y">
          {host.machines.map((machine) => (
            <li
              key={machine.id}
              className="flex items-center gap-2 py-4"
              data-machine-id={machine.id}
            >
              <MachineIconPicker
                machine={machine}
                onSave={async (icon) => {
                  await api.updateMachineIcon(machine.id, icon);
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{machine.name}</p>
                <p className="text-sm text-muted-foreground">
                  {machineStatusLabel(
                    machineAvailability(machine),
                    host.machineId === machine.id && host.phase === "ready",
                  )}
                </p>
              </div>
              <RenameMachineDialog
                machine={machine}
                onRename={async (name) => {
                  await api.renameMachine(machine.id, name);
                }}
              />
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
        {connected && (
          <div className="border-t py-4">
            <p className="mb-3 text-sm font-medium">{connected.name}</p>
            <DaemonDetails
              connection={connection}
              reportedVersion={connected.agentVersion}
              error={connected.agentError}
            />
          </div>
        )}
      </Section>
    </div>
  );
}
