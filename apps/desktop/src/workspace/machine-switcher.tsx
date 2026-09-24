import { MachineIcon } from "@/machines/machine-icon";
import { machineStatusLabel } from "@concors/client-core";
import type { Machine } from "@concors/api-client";
import { useMachineList } from "@/machines/use-machines";
import { resolveHostEndpoint } from "@/daemon/resolve-endpoint";
import { prewarmDaemonConnection, useReadyMachines } from "@/daemon/use-daemon-connection";
import {
  LOCAL_HOST,
  loadHosts,
  machineAvailability,
  machineHost,
  type Host,
  type HostAvailability,
} from "./machines";
import { useEffect, useRef, useState } from "react";
import { Activity, ChevronDown, Check, LoaderCircle, Settings2 } from "lucide-react";
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
  onOpenResources,
  compact = false,
}: {
  organizationId: string | undefined;
  scope: string;
  selected: Host;
  connected: boolean;
  onSelect: (host: Host) => void;
  onViewCloud: (machineId?: string) => void;
  onOpenResources: () => void;
  compact?: boolean;
}) {
  const [open, setMenuOpen] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const openRef = useRef(open);
  const setOpen = (next: boolean) => {
    openRef.current = next;
    setMenuOpen(next);
  };
  // Loaded up front so the list is already there, and recent, when the menu opens.
  const list = useMachineList(organizationId, !!organizationId);
  const cloudMachines = list.data?.filter((machine) => machine.status !== "deleted") ?? null;
  const loadError = !!list.error;
  const ready = useReadyMachines(scope);
  useEffect(() => {
    if (!open || !organizationId) return;
    void list.resource.load(15_000);
    const timer = setInterval(() => void list.resource.load(15_000), 15_000);
    return () => clearInterval(timer);
  }, [open, organizationId, list.resource]);
  /**
   * A cached list is judged as of when it was read, and a machine this device is connected to is
   * up whatever its last heartbeat says: neither may make a live machine look offline.
   */
  const availability = (machine: Machine, fetchedAt: number | null): HostAvailability =>
    ready.has(machine.id)
      ? "connectable"
      : // Always set alongside a list; without one there is nothing to judge.
        machineAvailability(machine, fetchedAt ?? 0);
  const hostFor = (machine: Machine) =>
    machineHost(
      machine,
      loadHosts(scope).find((h) => h.machineId === machine.id),
    );
  const choose = async (machine: Machine) => {
    if (availability(machine, list.fetchedAt) === "connectable") {
      setOpen(false);
      onSelect(hostFor(machine));
      return;
    }
    // Only send someone to Machines once a fresh read agrees the machine is unreachable.
    setChecking(machine.id);
    await list.resource.load(0, true);
    setChecking(null);
    // Closing the menu meanwhile means they changed their mind.
    if (!openRef.current) return;
    const snapshot = list.resource.getSnapshot();
    const fresh = snapshot.data?.find((candidate) => candidate.id === machine.id);
    setOpen(false);
    if (fresh && availability(fresh, snapshot.fetchedAt) === "connectable")
      onSelect(hostFor(fresh));
    else onViewCloud(machine.id);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <SidebarTooltip collapsed={compact}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            className={`group/machine relative flex min-w-0 items-center rounded-md hover:bg-sidebar-accent focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-sidebar-ring aria-expanded:bg-sidebar-accent ${compact ? "sidebar-rail-control" : "h-8 max-w-full gap-2 px-2 text-left"}`}
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
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-ui font-medium">{selected.label}</span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-3 shrink-0 text-muted-foreground transition-transform group-aria-expanded/machine:rotate-180 motion-reduce:transition-none"
                />
              </span>
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={compact ? "right" : "bottom"} sideOffset={6}>
          {selected.label} · {connected ? "Connected" : "Disconnected"} · Switch machine
        </TooltipContent>
      </SidebarTooltip>
      <DropdownMenuContent
        align="start"
        className="w-[calc(var(--sidebar-width)-16px)] max-w-[calc(100vw-24px)] p-1"
      >
        <DropdownMenuItem
          className="min-h-[32px] gap-2 px-[8px]"
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
          const machineState = availability(machine, list.fetchedAt);
          const isSelected = selected.machineId === machine.id;
          const status =
            checking === machine.id
              ? "Checking…"
              : machineStatusLabel(machineState, isSelected && connected);
          return (
            <DropdownMenuItem
              key={machine.id}
              className="min-h-[32px] gap-2 px-[8px]"
              aria-label={`${machine.name} ${status}${isSelected ? " Selected" : ""}`}
              title={`${machine.name} · ${status}${isSelected ? " · Selected" : ""}`}
              disabled={checking !== null}
              onPointerEnter={() => {
                if (!isSelected && machineState === "connectable")
                  prewarmDaemonConnection(
                    resolveHostEndpoint(hostFor(machine), null),
                    machine.id,
                    scope,
                  );
              }}
              onSelect={(event) => {
                // The menu stays open while an uncertain machine is rechecked.
                event.preventDefault();
                void choose(machine);
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
                {checking === machine.id ? (
                  <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${(isSelected && connected) || machineState === "connectable" ? "bg-emerald-500" : machineState === "provisioning" ? "bg-amber-500" : "bg-muted-foreground/50"}`}
                  />
                )}
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
        <DropdownMenuItem className="min-h-[32px] gap-2 px-[8px]" onSelect={onOpenResources}>
          <Activity />
          Resources
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-[32px] gap-2 px-[8px]" onSelect={() => onViewCloud()}>
          <Settings2 />
          Manage machines
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
