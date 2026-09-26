import { useEffect, useRef, useState } from "react";
import { newRequestId } from "@concors/client-core";
import type { DaemonConnection } from "@concors/daemon-client";
import type { MachineProcess } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/** Confirms, then asks the daemon to stop `process`; open while `process` is set. */
export function StopProcessDialog({
  connection,
  process,
  supported,
  onClose,
  onStopped,
}: {
  connection: DaemonConnection | null;
  process: MachineProcess | null;
  supported: boolean;
  onClose: () => void;
  onStopped: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = () => {
    setError(null);
    onClose();
  };
  const stop = async (item: MachineProcess) => {
    if (!connection || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await connection.requestResource(
        { kind: "stop", id: item.id },
        newRequestId(),
      );
      if (!alive.current) return;
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      if (result.outcome.status === "done") onStopped(result.outcome.message);
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Could not stop process.");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!process}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop process?</DialogTitle>
          <DialogDescription>
            Send a graceful termination request to this process only. Unsaved in-memory work may be
            lost. Child processes can remain; no force-kill is sent.
          </DialogDescription>
        </DialogHeader>
        {process && (
          <p className="text-sm break-all">
            {process.name} · PID {process.pid}
            <br />
            {process.directory}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!supported || busy}
            onClick={() => {
              if (process) void stop(process);
            }}
          >
            {busy ? "Working…" : "Stop process"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
