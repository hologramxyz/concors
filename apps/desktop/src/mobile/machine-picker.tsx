import { machineAvailability, machineStatusLabel, type MobileState } from "@concors/client-core";
import { Activity, Settings2 } from "lucide-react";
import { MachineIcon } from "@/machines/machine-icon";
import { MobileSelect } from "./select";

/** Sidebar switching uses the same current-machine status as machine settings. */
export function MobileMachinePicker({
  host,
  onSelect,
  onOpenResources,
  onManageMachines,
}: {
  host: MobileState;
  onSelect(machineId: string): void;
  onOpenResources: () => void;
  onManageMachines: () => void;
}) {
  return (
    <MobileSelect
      label="Machine"
      presentation="sheet"
      value={host.machineId ?? ""}
      placeholder={host.direct ? "Connecting to desktop…" : "Choose a machine"}
      onValueChange={onSelect}
      actions={[
        { label: "Resources", icon: <Activity />, onSelect: onOpenResources },
        { label: "Manage machines", icon: <Settings2 />, onSelect: onManageMachines },
      ]}
      groups={[
        host.direct
          ? {
              options: host.machineId
                ? [
                    {
                      value: host.machineId,
                      label: "This computer",
                      icon: <MachineIcon local />,
                      accessibleName: `This computer${host.phase === "ready" ? " Connected" : ""}`,
                    },
                  ]
                : [],
            }
          : {
              label: "Your machines",
              options: host.machines.map((machine) => {
                const availability = machineAvailability(machine);
                const selected = host.machineId === machine.id;
                return {
                  value: machine.id,
                  label: machine.name,
                  icon: <MachineIcon icon={machine.icon} />,
                  accessibleName: `${machine.name} ${machineStatusLabel(
                    availability,
                    selected && host.phase === "ready",
                  )}`,
                  ...(!selected && {
                    trailing: (
                      <span
                        aria-hidden="true"
                        className={`size-1.5 rounded-full ${availability === "connectable" ? "bg-emerald-500" : availability === "provisioning" ? "bg-amber-500" : "bg-muted-foreground/50"}`}
                      />
                    ),
                  }),
                  disabled: availability !== "connectable" || !host.capabilities.remoteAccess,
                };
              }),
            },
      ]}
    />
  );
}
