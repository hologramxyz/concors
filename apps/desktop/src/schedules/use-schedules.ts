import { useContext, useEffect, useState } from "react";
import type { AgentSchedule } from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";
import { TerminalConnectionContext } from "@/terminal/connection-context";

export function useSchedules() {
  const connection = useContext(TerminalConnectionContext);
  const [replica, setReplica] = useState<{
    connection: DaemonConnection;
    schedules: AgentSchedule[] | null;
  } | null>(null);
  useEffect(
    () =>
      connection?.onSchedules((schedules) =>
        // A dropped connection clears the client's list; keep showing it until the machine resyncs.
        setReplica((previous) =>
          schedules === null &&
          connection.state.status !== "ready" &&
          previous?.connection === connection
            ? previous
            : { connection, schedules },
        ),
      ),
    [connection],
  );
  return {
    connection,
    schedules: replica?.connection === connection ? (replica?.schedules ?? null) : null,
  };
}
