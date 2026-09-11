import type { Machine } from "@concors/api-client";
import { machineStatusLabel } from "@concors/client-core";
import { api } from "@/auth/api";
import { LOCAL_HOST, loadHosts, machineAvailability, machineHost, type Host } from "./machines";
import { useEffect, useState } from "react";
import { ChevronDown, Server, Plus } from "lucide-react";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
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
  compact = false,
}: {
  organizationId: string | undefined;
  scope: string;
  selected: Host;
  connected: boolean;
  onSelect: (host: Host) => void;
  onViewCloud: (machineId?: string) => void;
  compact?: boolean;
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
      <SidebarTooltip collapsed={compact}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            className={`relative flex min-w-0 items-center rounded-md hover:bg-sidebar-accent ${compact ? "sidebar-rail-control" : "h-9 w-fit gap-1.5 px-1.5 text-left"}`}
            aria-label="Switch machine"
          >
            <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {compact ? (
              <span
                role="img"
                aria-label={`${selected.label}: ${connected ? "Connected" : "Disconnected"}`}
                className={`absolute right-1 bottom-1 size-1.5 rounded-full ring-2 ring-sidebar ${connected ? "bg-emerald-500" : "bg-muted-foreground/60"}`}
              />
            ) : (
              <>
                <span className="min-w-0 truncate text-ui font-medium">{selected.label}</span>
                <ChevronDown className="size-3 shrink-0" />
              </>
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={compact ? "right" : "bottom"} sideOffset={6}>
          {selected.label} · {connected ? "Connected" : "Disconnected"} · Switch machine
        </TooltipContent>
      </SidebarTooltip>
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
                {machineStatusLabel(availability, isSelected && connected)}
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
