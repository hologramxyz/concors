import { MachineIcon } from "@/machines/machine-icon";
import { machineStatusLabel } from "@concors/client-core";
import { useMachineList } from "@/machines/use-machines";
import { LOCAL_HOST, loadHosts, machineAvailability, machineHost, type Host } from "./machines";
import { useEffect, useState } from "react";
import { ChevronDown, Check, Settings2 } from "lucide-react";
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
  const list = useMachineList(
    organizationId,
    (open || selected.machineId !== "local") && !!organizationId,
  );
  const cloudMachines = list.data?.filter((machine) => machine.status !== "deleted") ?? null;
  const loadError = !!list.error;
  useEffect(() => {
    if (!open || !organizationId) return;
    const timer = setInterval(() => void list.resource.load(15_000), 15_000);
    return () => clearInterval(timer);
  }, [open, organizationId, list.resource]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <SidebarTooltip collapsed={compact}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            className={`relative flex min-w-0 items-center rounded-md hover:bg-sidebar-accent ${compact ? "sidebar-rail-control" : "h-9 w-[192px] max-w-full gap-1.5 px-1.5 text-left"}`}
            aria-label="Switch machine"
          >
            {selected.machineId !== "local" && cloudMachines === null ? (
              <span className="size-4 shrink-0 rounded bg-muted" aria-hidden="true" />
            ) : (
              <MachineIcon
                local={selected.machineId === "local"}
                icon={cloudMachines?.find((machine) => machine.id === selected.machineId)?.icon}
                className="size-4 text-muted-foreground"
              />
            )}
            {compact ? (
              <span
                role="img"
                aria-label={`${selected.label}: ${connected ? "Connected" : "Disconnected"}`}
                className={`absolute right-1 bottom-1 size-1.5 rounded-full ring-2 ring-sidebar ${connected ? "bg-emerald-500" : "bg-muted-foreground/60"}`}
              />
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-ui font-medium">
                  {selected.label}
                </span>
                <ChevronDown className="size-3 shrink-0" />
              </>
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={compact ? "right" : "bottom"} sideOffset={6}>
          {selected.label} · {connected ? "Connected" : "Disconnected"} · Switch machine
        </TooltipContent>
      </SidebarTooltip>
      <DropdownMenuContent
        align="start"
        style={{ width: 320, maxWidth: "calc(100vw - 24px)" }}
        className="p-1.5"
      >
        <DropdownMenuItem
          className="min-h-10 gap-3 px-2.5"
          onSelect={() => onSelect(LOCAL_HOST)}
          aria-label={`This computer${selected.machineId === "local" ? (connected ? " Connected" : " Selected") : ""}`}
          title={`This computer${selected.machineId === "local" ? (connected ? " · Connected" : " · Selected") : ""}`}
        >
          <MachineIcon local />
          <span className="min-w-0 flex-1 truncate">This computer</span>
          <span className="flex w-9 shrink-0 items-center justify-end gap-2" aria-hidden="true">
            {selected.machineId === "local" && (
              <>
                {connected && <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />}
                <Check className="size-4 text-primary" />
              </>
            )}
          </span>
        </DropdownMenuItem>
        {cloudMachines?.map((machine) => {
          const availability = machineAvailability(machine);
          const isSelected = selected.machineId === machine.id;
          const status = machineStatusLabel(availability, isSelected && connected);
          return (
            <DropdownMenuItem
              key={machine.id}
              className="min-h-10 gap-3 px-2.5"
              aria-label={`${machine.name} ${status}${isSelected ? " Selected" : ""}`}
              title={`${machine.name} · ${status}${isSelected ? " · Selected" : ""}`}
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
              <MachineIcon
                icon={machine.icon}
                className={`size-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
              />
              <span
                className={`min-w-0 flex-1 truncate ${isSelected ? "font-medium text-primary" : ""}`}
                title={machine.name}
              >
                {machine.name}
              </span>
              <span className="flex w-9 shrink-0 items-center justify-end gap-2" aria-hidden="true">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${(isSelected && connected) || availability === "connectable" ? "bg-emerald-500" : availability === "provisioning" ? "bg-amber-500" : "bg-muted-foreground/50"}`}
                />
                {isSelected ? (
                  <Check className="size-4 text-primary" />
                ) : (
                  <span className="size-4" />
                )}
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
              void list.refresh();
            }}
          >
            Retry loading cloud machines
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-10 gap-3 px-2.5" onSelect={() => onViewCloud()}>
          <Settings2 />
          Manage machines
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
