import { useContext, useEffect, useState } from "react";
import type { SupervisorDelivery } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";

/**
 * What this Supervisor conversation has sent, newest first: the daemon's own delivery records,
 * which every Supervisor-capable daemon reports through `status`. Agent events say when a turn,
 * queue or request changed, so a burst of them is coalesced into one read.
 */
export function useSupervisorDeliveries(supervisorId: string | null) {
  const connection = useContext(TerminalConnectionContext);
  const [loaded, setLoaded] = useState<{
    supervisorId: string | null;
    deliveries: SupervisorDelivery[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!connection) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    const read = async () => {
      const request = ++generation;
      try {
        const result = await connection.requestSupervisor({ kind: "status" }, crypto.randomUUID());
        if (disposed || request !== generation) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        setLoaded({
          supervisorId,
          deliveries: result.outcome.deliveries.filter(
            (item) => item.supervisorId === supervisorId,
          ),
        });
        setError(null);
      } catch (cause) {
        if (!disposed && request === generation)
          setError(cause instanceof Error ? cause.message : "Could not load activity.");
      }
    };
    // Subscribing replays the current agent list, which makes the first read.
    const off = connection.onAgent((event) => {
      if (event.type !== "agent.state" && event.type !== "agent.list") return;
      timer ??= setTimeout(() => {
        timer = undefined;
        void read();
      }, 150);
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      off();
    };
  }, [connection, supervisorId]);
  return {
    deliveries: loaded?.supervisorId === supervisorId ? loaded.deliveries : [],
    warning: error,
  };
}
