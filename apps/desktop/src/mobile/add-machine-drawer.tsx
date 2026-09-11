import type { MobileState } from "@concors/client-core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExistingMachines } from "./existing-machines";

/** A setup handoff, not a provisioning or purchasing flow. */
export function AddMachineDrawer({
  host,
  open,
  onOpenChange,
}: {
  host: MobileState;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add machine</DialogTitle>
          <DialogDescription>
            {host.direct
              ? "This private preview is paired with one desktop daemon."
              : "Connect a machine already set up in your Concourse organization."}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {host.direct
            ? "To use another computer, configure its daemon and a private preview connection first. This preview cannot add or switch to an unpaired computer."
            : "Set up the machine in the desktop app using the same account and organization, then refresh below. Creating machines is not available in mobile yet."}
        </p>
        {!host.direct && <ExistingMachines host={host} onConnected={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
