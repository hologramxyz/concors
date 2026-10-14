import { useState } from "react";
import type { Host } from "@concors/client-core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyButton } from "@/agents/markdown";
import { useMachineList } from "@/machines/use-machines";
import { unreachableHelp } from "./unreachable-help";

/** "What's wrong?" beside a connection problem: why the machine is out of reach, and what to check. */
export function UnreachableHelpButton({
  host,
  organizationId,
  onRetry,
}: {
  host: Host;
  organizationId: string | undefined;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  // When it was opened: heartbeat ages are judged against that, not re-read on every render.
  const [openedAt, setOpenedAt] = useState(0);
  const local = host.machineId === "local";
  // Read fresh while open: the last heartbeat is what tells a running machine from a stopped one.
  const list = useMachineList(organizationId, open && !local && !!organizationId);
  const machine = list.data?.find((item) => item.id === host.machineId);
  const seen = machine?.agentSeenAt ? Date.parse(machine.agentSeenAt) : NaN;
  const help = unreachableHelp({
    kind: local ? "local" : machine?.provider === "external" ? "own" : "concors",
    relayed: machine?.connection === "relay",
    seenAgo: Number.isNaN(seen) ? null : Math.max(0, openedAt - seen),
  });
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setOpenedAt(Date.now());
          setOpen(true);
        }}
      >
        What&apos;s wrong?
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Can&apos;t reach {host.label}</DialogTitle>
            <DialogDescription>
              Concors keeps trying to reconnect on its own. Your sessions stay on the machine.
            </DialogDescription>
          </DialogHeader>
          {help.status && (
            <p role="status" className="rounded-md border bg-muted/40 p-3 text-sm">
              {help.status}
            </p>
          )}
          <div className="text-sm">
            <p className="font-medium">Common causes</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted-foreground">
              {help.causes.map((cause) => (
                <li key={cause}>{cause}</li>
              ))}
            </ul>
          </div>
          {help.commands && (
            <div className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">On the server, these show what happened</p>
                <CopyButton text={help.commands} label="Copy commands" />
              </div>
              <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                {help.commands}
              </pre>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => {
                onRetry();
                setOpen(false);
              }}
            >
              Retry now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
