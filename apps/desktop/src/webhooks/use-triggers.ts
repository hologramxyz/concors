import { useContext, useEffect, useState } from "react";
import type { AgentTrigger } from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";
import { TerminalConnectionContext } from "@/terminal/connection-context";

export function useTriggers() {
  const connection = useContext(TerminalConnectionContext);
  const [replica, setReplica] = useState<{
    connection: DaemonConnection;
    triggers: AgentTrigger[] | null;
  } | null>(null);
  useEffect(
    () =>
      connection?.onTriggers((triggers) =>
        setReplica((previous) =>
          triggers === null &&
          connection.state.status !== "ready" &&
          previous?.connection === connection
            ? previous
            : { connection, triggers },
        ),
      ),
    [connection],
  );
  return {
    connection,
    triggers: replica?.connection === connection ? (replica?.triggers ?? null) : null,
  };
}
