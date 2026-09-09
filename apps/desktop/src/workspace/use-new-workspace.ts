import { useEffect, useRef, useState } from "react";
import type { DaemonConnection } from "@concors/daemon-client";

export function useNewWorkspace(connection: DaemonConnection | null) {
  const active = useRef<{ connection: DaemonConnection; id: string } | null>(null);
  const [busy, setBusy] = useState<DaemonConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    return connection?.subscribeProjectSetups((setups) => {
      if (active.current?.connection !== connection) return;
      const setup = setups.find((item) => item.id === active.current?.id);
      if (!setup || setup.status === "working") return;
      active.current = null;
      setBusy(null);
      if (setup.status !== "done") setError(setup.progress);
    });
  }, [connection]);
  const start = () => {
    if (
      !connection?.workspace ||
      connection.state.status !== "ready" ||
      active.current?.connection === connection
    )
      return;
    if (!connection.state.daemon.capabilities?.includes("folder-workspaces")) {
      setError("Update this machine to create folder workspaces.");
      return;
    }
    const id = crypto.randomUUID();
    active.current = { connection, id };
    setBusy(connection);
    setError(null);
    void connection
      .requestProject(
        { kind: "workspace", epoch: connection.workspace.epoch, id },
        crypto.randomUUID(),
      )
      .then(({ outcome }) => {
        if (outcome.status === "error") throw new Error(outcome.message);
      })
      .catch((cause: unknown) => {
        if (active.current?.id !== id) return;
        active.current = null;
        setBusy(null);
        setError(cause instanceof Error ? cause.message : "Could not start a workspace.");
      });
  };
  return {
    start,
    busy: !!busy && busy === connection,
    error,
    dismiss: () => setError(null),
  };
}
