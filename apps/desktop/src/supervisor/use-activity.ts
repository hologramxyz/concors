import { useContext, useEffect, useState } from "react";
import {
  SUPERVISOR_BRIEFS_CAPABILITY,
  type AgentInfo,
  type SupervisorBrief,
  type SupervisorDelivery,
} from "@concors/protocol";
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

/**
 * The latest reply of each listed session, for Activity's one-line summaries. A reply changes only
 * when its session's turn or status does, so the request is made again only then. Null when the
 * daemon cannot brief, and Activity simply shows no summaries.
 */
export function useSupervisorBriefs(sessions: readonly AgentInfo[]) {
  const connection = useContext(TerminalConnectionContext);
  const supported =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(SUPERVISOR_BRIEFS_CAPABILITY);
  const [briefs, setBriefs] = useState<ReadonlyMap<string, SupervisorBrief>>(new Map());
  const key = sessions
    .slice(0, 64)
    .map((agent) => `${agent.id} ${agent.turnId ?? ""} ${agent.status}`)
    .join("\n");
  useEffect(() => {
    if (!connection || !supported || !key) return;
    let current = true;
    const sessionIds = key.split("\n").map((entry) => entry.split(" ")[0] ?? "");
    const timer = setTimeout(() => {
      void connection.requestSupervisor({ kind: "briefs", sessionIds }, crypto.randomUUID()).then(
        (result) => {
          if (current && result.outcome.status === "ok")
            setBriefs(new Map((result.outcome.briefs ?? []).map((b) => [b.sessionId, b])));
        },
        () => undefined,
      );
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [connection, supported, key]);
  return supported ? briefs : null;
}
