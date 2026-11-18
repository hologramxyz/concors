import { useContext, useEffect, useRef, useState } from "react";
import {
  SUPERVISOR_ACTIVITY_CAPABILITY,
  type SupervisorDelivery,
  type SupervisorOperation,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";

interface ActivitySnapshot {
  deliveries: SupervisorDelivery[];
  watching: string[];
}
const empty: ActivitySnapshot = { deliveries: [], watching: [] };

export function useSupervisorActivity(supervisorId: string | null) {
  const connection = useContext(TerminalConnectionContext);
  const [loaded, setLoaded] = useState<{
    supervisorId: string | null;
    snapshot: ActivitySnapshot;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const change = useRef<((operation: SupervisorOperation) => Promise<void>) | null>(null);
  const canWatch =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(SUPERVISOR_ACTIVITY_CAPABILITY);

  useEffect(() => {
    if (!connection) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    const read = async (operation: SupervisorOperation) => {
      const request = ++generation;
      try {
        const result = await connection.requestSupervisor(operation, crypto.randomUUID());
        if (disposed || request !== generation) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        setLoaded({
          supervisorId,
          snapshot: {
            deliveries: result.outcome.deliveries.filter(
              (item) => item.supervisorId === supervisorId,
            ),
            watching: result.outcome.watching ?? [],
          },
        });
        setError(null);
      } catch (cause) {
        if (!disposed && request === generation)
          setError(cause instanceof Error ? cause.message : "Could not load activity.");
      }
    };
    let mutating = false;
    // Agent events follow changes to turns, follow-ups, and approval requests. Coalesce a burst.
    const refresh = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        if (!mutating) void read({ kind: "status" });
      }, 150);
    };
    const off = connection.onAgent((event) => {
      if (event.type === "agent.state" || event.type === "agent.list") refresh();
    });
    const mutate = async (operation: SupervisorOperation) => {
      mutating = true;
      try {
        await read(operation);
      } finally {
        mutating = false;
      }
    };
    // Keep the same request guard for manual changes and event refreshes.
    change.current = mutate;
    return () => {
      change.current = null;
      disposed = true;
      clearTimeout(timer);
      off();
    };
  }, [connection, supervisorId, canWatch]);

  return {
    ...(loaded?.supervisorId === supervisorId ? loaded.snapshot : empty),
    warning: error,
    watch:
      canWatch && supervisorId
        ? (sessionId: string, enabled: boolean) =>
            change.current?.({ kind: "watch", supervisorId, sessionId, enabled }) ??
            Promise.resolve()
        : null,
  };
}
