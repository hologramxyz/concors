import { machineAvailability, machineStatusLabel, type MobileState } from "@concors/client-core";
import { Monitor } from "lucide-react";
import { MachineIcon } from "@/machines/machine-icon";
import { MobileSelect } from "./select";

/** Sidebar switching uses the same current-machine status as machine settings. */
export function MobileMachinePicker({
  host,
  onSelect,
}: {
  host: MobileState;
  onSelect(machineId: string): void;
}) {
  return (
    <MobileSelect
      label="Machine"
      presentation="sheet"
      value={host.machineId ?? ""}
      placeholder={host.direct ? "Connecting to desktop…" : "Choose a machine"}
      onValueChange={onSelect}
      groups={[
        {
          label: host.direct ? "Direct connection" : "Your machines",
          options: host.direct
            ? host.machineId
              ? [
                  {
                    value: host.machineId,
                    label: "Desktop daemon",
                    icon: <Monitor />,
                    description: host.phase === "ready" ? "Connected · real workspace" : host.phase,
                  },
                ]
              : []
            : host.machines.map((machine) => ({
                value: machine.id,
                label: machine.name,
                icon: <MachineIcon icon={machine.icon} />,
                description: machineStatusLabel(
                  machineAvailability(machine),
                  host.machineId === machine.id && host.phase === "ready",
                ),
                disabled:
                  machineAvailability(machine) !== "connectable" || !host.capabilities.remoteAccess,
              })),
        },
      ]}
    />
  );
}
