import {
  ApiError,
  type CreateMachineInput,
  type Machine,
  type MachineCatalog,
} from "@concors/api-client";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/auth/api";
import { describeAuthError } from "@/auth/auth-state";

import { isSettling } from "./format.ts";

/** How often the list is re-read while a machine is still being set up or torn down. */
const SETTLING_POLL_MS = 15_000;

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
}

/**
 * Machines of one organization plus the catalog to create more. Re-reads the list while any
 * machine is provisioning or deleting, since the server only refreshes from OVH when asked.
 */
export function useMachines(organizationId: string | undefined): MachinesState {
  const [machines, setMachines] = useState<readonly Machine[] | null>(null);
  const [catalog, setCatalog] = useState<MachineCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generation, setGeneration] = useState(0);
  const latest = useRef(0);

  const scope = organizationId === undefined ? {} : { organizationId };

  useEffect(() => {
    const ticket = ++latest.current;
    void Promise.all([
      api.listMachines(scope),
      catalog === null ? api.getMachineCatalog() : Promise.resolve(catalog),
    ])
      .then(([list, loadedCatalog]) => {
        if (ticket !== latest.current) return;
        setMachines(list);
        setCatalog(loadedCatalog);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (ticket === latest.current) setError(describeMachinesError(cause));
      })
      .finally(() => {
        if (ticket === latest.current) setLoading(false);
      });
    // `catalog` is only read to avoid re-fetching it; changes to it must not trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, generation]);

  useEffect(() => {
    if (!machines?.some(isSettling)) return;
    const timer = setTimeout(() => setGeneration((n) => n + 1), SETTLING_POLL_MS);
    return () => clearTimeout(timer);
  }, [machines]);

  const reload = useCallback(() => {
    setLoading(true);
    setGeneration((n) => n + 1);
  }, []);

  const create = useCallback(
    async (input: Omit<CreateMachineInput, "organizationId">) => {
      const machine = await api.createMachine({ ...input, ...scope });
      setMachines((current) => [machine, ...(current ?? [])]);
      return machine;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [organizationId],
  );

  const replace = (machine: Machine) =>
    setMachines((current) =>
      (current ?? [])
        .map((candidate) => (candidate.id === machine.id ? machine : candidate))
        .filter((candidate) => candidate.status !== "deleted"),
    );
  const cancel = useCallback(async (id: string) => replace(await api.cancelMachine(id)), []);
  const resume = useCallback(async (id: string) => replace(await api.resumeMachine(id)), []);

  return {
    machines,
    catalog,
    error,
    loading: loading || (machines === null && error === null),
    reload,
    create,
    cancel,
    resume,
  };
}

/** Human message for a failed machine call; `describeAuthError` already covers network and 5xx. */
export function describeMachinesError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 402) {
    return `${cause.message}. Add a payment method in Settings → Billing.`;
  }
  if (cause instanceof ApiError && cause.status < 500) return cause.message;
  return describeAuthError(cause);
}
