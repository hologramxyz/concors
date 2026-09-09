import type { Machine } from "@concors/api-client";
import { api } from "@/auth/api";
import { describeStatus } from "@/machines/format";
import { useEffect, useState } from "react";
import { ChevronDown, Server, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MachineConnection } from "./machines";

export function MachineSwitcher({
  organizationId,
  machines,
  selectedId,
  onSelect,
  onViewCloud,
}: {
  organizationId: string | undefined;
  machines: MachineConnection[];
  selectedId: string;
  onSelect: (id: string) => void;
  onViewCloud: (machineId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cloudMachines, setCloudMachines] = useState<Machine[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [generation, setGeneration] = useState(0);

  // The sidebar keys this component by organization. Refresh on every opening so newly
  // created machines appear immediately, and keep their status current while it stays open.
  useEffect(() => {
    if (!open || !organizationId) return;
    const scope = { organizationId };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const loaded = await api.listMachines(scope);
        if (!cancelled) {
          setCloudMachines(loaded.filter((machine) => machine.status !== "deleted"));
          setLoadError(false);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) timer = setTimeout(() => void refresh(), 15_000);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, organizationId, generation]);
  const selected = machines.find((machine) => machine.id === selectedId);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
        {cloudMachines?.map((machine) => (
          <DropdownMenuItem key={`cloud-${machine.id}`} onSelect={() => onViewCloud(machine.id)}>
            <Server />
            <span className="min-w-0 flex-1 truncate" title={machine.name}>
              {machine.name}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {describeStatus(machine)}
            </span>
          </DropdownMenuItem>
        ))}
        {organizationId && cloudMachines === null && !loadError && (
          <DropdownMenuItem disabled>Loading cloud machines…</DropdownMenuItem>
        )}
        {loadError && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setGeneration((n) => n + 1);
            }}
          >
            Retry loading cloud machines
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onViewCloud()}>
          <Plus />
          Add a machine
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
