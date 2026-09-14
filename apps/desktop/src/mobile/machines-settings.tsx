import { useState } from "react";
import { Plus } from "lucide-react";
import type { MobileState } from "@concors/client-core";
import { Button } from "@/components/ui/button";
import { Section } from "@/views/settings-primitives";
import { AddMachineDrawer } from "./add-machine-drawer";
import { ExistingMachines } from "./existing-machines";
import { hostAction } from "./bridge";

/** Machine management stays in Settings in both cloud and direct-preview modes. */
export function MachinesSettings({
  host,
  onConnected,
}: {
  host: MobileState;
  onConnected(): void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: "retry" | "sign-out") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await hostAction({ kind });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update connection");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {host.direct ? (
        <div className="p-4">
          <Section title="Machines" description="Your connected desktop and this device.">
            <p className="font-medium">{host.endpointLabel ?? "Desktop daemon"}</p>
            <p className="py-3 text-xs break-all text-muted-foreground">
              Machine ID: {host.machineId ?? "Waiting for daemon…"}
            </p>
            {error && (
              <p role="alert" className="pb-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" disabled={busy} onClick={() => void run("retry")}>
                Reconnect
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void run("sign-out")}>
                Disconnect desktop
              </Button>
            </div>
            <p className="pt-3 text-sm text-muted-foreground">
              Disconnecting does not stop agents or terminals.
            </p>
          </Section>
        </div>
      ) : (
        <ExistingMachines host={host} onConnected={onConnected} />
      )}
      <div className="px-4 pb-4">
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" />
          Add machine
        </Button>
      </div>
      <AddMachineDrawer host={host} open={adding} onOpenChange={setAdding} />
    </>
  );
}
