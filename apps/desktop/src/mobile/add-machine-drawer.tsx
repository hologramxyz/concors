import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** A setup handoff, not a provisioning or purchasing flow. */
export function AddMachineDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add machine</DialogTitle>
          <DialogDescription>Add machines in the Concors desktop app.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
