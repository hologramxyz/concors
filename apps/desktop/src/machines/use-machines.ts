import {
  ApiError,
  type CreateMachineInput,
  type Machine,
  type MachineCatalog,
} from "@concors/api-client";
import { useCallback, useEffect } from "react";

import { api } from "@/auth/api";
import { describeAuthError } from "@/auth/auth-state";

import { useApiResource } from "@/data/api-resource";

import { isSettling } from "./format.ts";

/** How often the list is re-read while a machine is still being set up or torn down. */
const SETTLING_POLL_MS = 15_000;
const RESOURCE_POLL_MS = 30_000;

export interface MachinesState {
  readonly machines: readonly Machine[] | null;
  readonly catalog: MachineCatalog | null;
  /** Set when loading failed; the last known list stays visible. */
  readonly error: string | null;
  readonly loading: boolean;
  reload(): void;
  create(input: Omit<CreateMachineInput, "organizationId">): Promise<Machine>;
  /** Stops the renewals; the machine keeps running until its paid month ends. */
  cancel(id: string): Promise<void>;
  /** Undoes `cancel` while the month is still running. */
  resume(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  setIcon(id: string, icon: string | null): Promise<void>;
}

/**
 * Machines of one organization plus the catalog to create more. Polls current resource usage while visible,
 * more often during provisioning or deletion. Failed refreshes keep retrying.
 */
export function useMachines(organizationId: string | undefined): MachinesState {
  const scope = organizationId === undefined ? {} : { organizationId };
  const list = useMachineList(organizationId);
  const catalog = useApiResource("machine-catalog", () => api.getMachineCatalog(), {
    staleTime: 300_000,
  });
  const machines = list.data;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible")
        void list.resource.load(machines?.some(isSettling) ? SETTLING_POLL_MS : RESOURCE_POLL_MS);
    };
    const timer = setInterval(
      refresh,
      machines?.some(isSettling) ? SETTLING_POLL_MS : RESOURCE_POLL_MS,
    );
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [machines, list.resource]);

  const replace = useCallback(
    (machine: Machine) => {
      list.resource.set((current) =>
        (current ?? [])
          .map((candidate) => (candidate.id === machine.id ? machine : candidate))
          .filter((candidate) => candidate.status !== "deleted"),
      );
    },
    [list.resource],
  );

  return {
    machines,
    catalog: catalog.data,
    error: list.error || catalog.error ? describeMachinesError(list.error ?? catalog.error) : null,
    loading: list.pending || catalog.pending || (machines === null && !list.error),
    reload: () => {
      void list.refresh();
      void catalog.refresh();
    },
    create: async (input) => {
      const machine = await api.createMachine({ ...input, ...scope });
      list.resource.set((current) => [
        machine,
        ...(current ?? []).filter((item) => item.id !== machine.id),
      ]);
      return machine;
    },
    cancel: async (id) => replace(await api.cancelMachine(id)),
    resume: async (id) => replace(await api.resumeMachine(id)),
    rename: async (id, name) => replace(await api.renameMachine(id, name)),
    setIcon: async (id, icon) => replace(await api.updateMachineIcon(id, icon)),
  };
}

/** Human message for a failed machine call; `describeAuthError` already covers network and 5xx. */
export function describeMachinesError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 402) {
    return `${cause.message}. Check your payment method and try again.`;
  }
  if (cause instanceof ApiError && cause.status < 500) return cause.message;
  return describeAuthError(cause);
}

/** Shared by the Machines page and switcher, including successful mutations. */
export function useMachineList(organizationId: string | undefined, enabled = true) {
  return useApiResource(
    `machines:${organizationId ?? ""}`,
    () => api.listMachines(organizationId === undefined ? {} : { organizationId }),
    { enabled, staleTime: SETTLING_POLL_MS },
  );
}
