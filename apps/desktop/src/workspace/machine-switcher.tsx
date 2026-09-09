import { useState } from "react";
import { ChevronDown, Server, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { describeDaemonEndpoint } from "@concors/daemon-client";
import { FormDialog } from "./form-dialog";
import { MachineConnectionSchema, type MachineConnection } from "./machines";

export function MachineSwitcher({
  machines,
  selectedId,
  onSelect,
  onAdd,
}: {
  machines: MachineConnection[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: (machine: MachineConnection) => void;
}) {
  const [adding, setAdding] = useState(false);
  const selected = machines.find((machine) => machine.id === selectedId);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-9 w-fit min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-sidebar-accent"
          aria-label="Switch machine"
        >
          <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 truncate text-ui font-medium">
            {selected?.name ?? "This computer"}
          </span>
          <ChevronDown className="size-3 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {machines.map((machine) => (
            <DropdownMenuItem key={machine.id} onSelect={() => onSelect(machine.id)}>
              <Server />
              {machine.name}
              {machine.id === selectedId && (
                <span className="ml-auto text-xs text-muted-foreground">Selected</span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAdding(true)}>
            <Plus />
            Connect a machine…
          </DropdownMenuItem>
          <DropdownMenuItem disabled>Create cloud machine · coming soon</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {adding && (
        <FormDialog
          title="Connect a machine"
          description="Connect an existing daemon through a trusted local or protected connection. Cloud provisioning will be available later."
          fields={[
            { name: "name", label: "Machine name", placeholder: "Development machine" },
            { name: "url", label: "Daemon URL", placeholder: "wss://your-machine.example/ws" },
          ]}
          submitLabel="Add connection"
          onClose={() => setAdding(false)}
          onSubmit={(values) => {
            const endpoint = describeDaemonEndpoint(values["url"] ?? "");
            const machine = MachineConnectionSchema.parse({
              id: crypto.randomUUID(),
              name: values["name"],
              url: endpoint.url,
            });
            onAdd(machine);
            return Promise.resolve();
          }}
        />
      )}
    </>
  );
}
