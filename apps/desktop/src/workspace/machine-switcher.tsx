import type { Machine } from "@concors/api-client";
import { machineStatusLabel } from "@concors/client-core";
import { api } from "@/auth/api";
import { LOCAL_HOST, loadHosts, machineAvailability, machineHost, type Host } from "./machines";
import { useEffect, useState } from "react";
import { ChevronDown, Server, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MachineSwitcher({
  organizationId,
  scope,
  selected,
  connected,
  onSelect,
  onViewCloud,
}: {
  organizationId: string | undefined;
  scope: string;
  selected: Host;
  connected: boolean;
  onSelect: (host: Host) => void;
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

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="flex h-9 w-fit min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-sidebar-accent"
        aria-label="Switch machine"
      >
        <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate text-ui font-medium">{selected.label}</span>
        <ChevronDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onSelect={() => onSelect(LOCAL_HOST)}>
          <Server className={selected.machineId === "local" ? "text-primary" : undefined} />
          <span
            className={`min-w-0 flex-1 truncate ${selected.machineId === "local" ? "font-medium text-primary" : ""}`}
          >
            This computer
          </span>
          {selected.machineId === "local" && (
            <span className="ml-auto shrink-0 text-xs text-primary">
              {connected ? "Connected" : "Selected"}
            </span>
          )}
        </DropdownMenuItem>
        {cloudMachines?.map((machine) => {
          const availability = machineAvailability(machine);
          const isSelected = selected.machineId === machine.id;
          return (
            <DropdownMenuItem
              key={machine.id}
              onSelect={() => {
                if (machineAvailability(machine) !== "connectable") return onViewCloud(machine.id);
                onSelect(
                  machineHost(
                    machine,
                    loadHosts(scope).find((h) => h.machineId === machine.id),
                  ),
                );
              }}
            >
              <Server className={isSelected ? "text-primary" : undefined} />
              <span
                className={`min-w-0 flex-1 truncate ${isSelected ? "font-medium text-primary" : ""}`}
                title={machine.name}
              >
                {machine.name}
              </span>
              <span
                className={`ml-auto shrink-0 text-xs capitalize ${isSelected ? "text-primary" : "text-muted-foreground"}`}
              >
                {isSelected && !connected
                  ? "Selected"
                  : machineStatusLabel(availability, isSelected && connected)}
              </span>
            </DropdownMenuItem>
          );
        })}
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
