import { describeDaemonEndpoint } from "@concors/daemon-client";
import { FormDialog } from "@/workspace/form-dialog";
import { MachineConnectionSchema, type MachineConnection } from "@/workspace/machines";
import type { Machine } from "@concors/api-client";
import { cn } from "cn";
import { CalendarX, Check, Cloud, Copy, Plus, RefreshCw, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { CreateMachineDialog } from "./create-machine-dialog.tsx";
import {
  describeEnding,
  describeStatus,
  formatMonthly,
  sshCommand,
  STATUS_TONE,
  type StatusTone,
} from "./format.ts";
import { describeMachinesError, useMachines } from "./use-machines.ts";

interface MachinesViewProps {
  readonly auth: SignedInAuth;
  readonly onAddMachine: (machine: MachineConnection) => void;
  readonly focusedMachineId: string | null;
  readonly creating: boolean;
  readonly onCreatingChange: (creating: boolean) => void;
}

/** Cloud machines of the active organization: list, create, cancel, and how to connect. */
export function MachinesView({
  auth,
  onAddMachine,
  focusedMachineId,
  creating,
  onCreatingChange: setCreating,
}: MachinesViewProps) {
  const organization = activeOrganization(auth);
  const state = useMachines(organization?.id);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Machine | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (focusedMachineId)
      document
        .getElementById(`cloud-machine-${focusedMachineId}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [focusedMachineId, state.machines]);

  const machines = state.machines ?? [];
  const empty = state.machines !== null && machines.length === 0;

  return (
    <div data-machines-view className="mx-auto flex h-full w-full max-w-3xl flex-col px-8 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">Machines</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Servers Concors runs for {organization?.name ?? "your organization"}, billed monthly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={state.reload}
            disabled={state.loading}
            aria-label="Refresh"
          >
            <RefreshCw className={cn(state.loading && "animate-spin")} aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" className="gap-2 leading-none" disabled>
            <span className="inline-flex h-full items-center">Connect a machine</span>
            <span className="inline-flex h-5 items-center rounded bg-muted px-1.5 text-[10px] leading-none">
              Coming soon
            </span>
          </Button>
          <Button size="sm" onClick={() => setCreating(true)} disabled={state.catalog === null}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            New machine
          </Button>
        </div>
      </div>

      {(state.error ?? actionError) && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{actionError ?? state.error}</span>
          <button type="button" className="text-xs" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {state.machines === null && !state.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading machines…
        </p>
      ) : empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <Cloud className="size-10 text-muted-foreground/50" aria-hidden="true" />
          <h3 className="text-lg font-medium">No machines yet</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create a server for this organization. Add an SSH key in Settings first so you can log
            in to it.
          </p>
          <Button size="sm" onClick={() => setCreating(true)} disabled={state.catalog === null}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            New machine
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {machines.map((machine) => (
            <li
              key={machine.id}
              id={`cloud-machine-${machine.id}`}
              className={cn(machine.id === focusedMachineId && "rounded-lg ring-2 ring-primary/40")}
            >
              <MachineCard
                machine={machine}
                onCancel={() => setCancelling(machine)}
                resuming={resuming === machine.id}
                onResume={() => {
                  setResuming(machine.id);
                  setActionError(null);
                  void state
                    .resume(machine.id)
                    .catch((cause: unknown) => setActionError(describeMachinesError(cause)))
                    .finally(() => setResuming(null));
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <FormDialog
          title="Connect a machine"
          description="Connect an existing daemon through a trusted local or protected connection."
          fields={[
            { name: "name", label: "Machine name", placeholder: "Development machine" },
            { name: "url", label: "Daemon URL", placeholder: "wss://your-machine.example/ws" },
          ]}
          submitLabel="Add connection"
          onClose={() => setAdding(false)}
          onSubmit={(values) => {
            const endpoint = describeDaemonEndpoint(values["url"] ?? "");
            const machine = MachineConnectionSchema.parse({
              id: crypto.randomUUID(),
              name: values["name"],
              url: endpoint.url,
            });
            onAddMachine(machine);
            return Promise.resolve();
          }}
        />
      )}

      {creating && state.catalog && organization && (
        <CreateMachineDialog
          organizationId={organization.id}
          organizationName={organization.name}
          catalog={state.catalog}
          onCreate={async (input) => {
            await state.create(input).catch((cause: unknown) => {
              throw new Error(describeMachinesError(cause));
            });
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {cancelling && (
        <CancelMachineDialog
          machine={cancelling}
          onConfirm={async () => {
            await state.cancel(cancelling.id).catch((cause: unknown) => {
              throw new Error(describeMachinesError(cause));
            });
          }}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground/50",
  pending: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-destructive",
};

function MachineCard({
  machine,
  onCancel,
  onResume,
  resuming,
}: {
  readonly machine: Machine;
  readonly onCancel: () => void;
  readonly onResume: () => void;
  readonly resuming: boolean;
}) {
  const command = sshCommand(machine);
  const tone = STATUS_TONE[machine.status];
  const ending = describeEnding(machine);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                TONE_CLASS[tone],
                tone === "pending" && "animate-pulse",
              )}
              aria-hidden="true"
            />
            <h3 className="truncate font-medium">{machine.name}</h3>
            <Badge variant="outline">{describeStatus(machine)}</Badge>
            {ending && <Badge variant="secondary">{ending}</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="capitalize">{machine.size}</span> · {machine.region} ·{" "}
            {formatMonthly(machine.monthlyPrice)}
          </p>
        </div>
        {ending ? (
          <Button variant="outline" size="sm" onClick={onResume} disabled={resuming}>
            <Undo2 data-icon="inline-start" aria-hidden="true" />
            {resuming ? "Resuming…" : "Keep machine"}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            aria-label={`Cancel ${machine.name}`}
          >
            <CalendarX aria-hidden="true" />
          </Button>
        )}
      </div>

      {machine.lastError && (
        <p role="alert" className="selectable mt-3 text-xs text-destructive">
          {machine.lastError}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Address</dt>
        <dd className="selectable font-mono">{machine.ipv4 ?? "assigning…"}</dd>
        <dt className="text-muted-foreground">Connect</dt>
        <dd className="flex items-center gap-2">
          {command ? (
            <>
              <code className="selectable font-mono">{command}</code>
              <CopyButton text={command} />
            </>
          ) : (
            <span className="text-muted-foreground">
              {machine.status === "provisioning" ? "available once installed" : "—"}
            </span>
          )}
        </dd>
        {machine.paidUntil && (
          <>
            <dt className="text-muted-foreground">Paid until</dt>
            <dd>
              {new Date(machine.paidUntil).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function CopyButton({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Copy SSH command"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  );
}

function CancelMachineDialog({
  machine,
  onConfirm,
  onClose,
}: {
  readonly machine: Machine;
  readonly onConfirm: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const until = machine.paidUntil
    ? new Date(machine.paidUntil).toLocaleDateString(undefined, { dateStyle: "medium" })
    : "the end of the paid month";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {machine.name}?</DialogTitle>
          <DialogDescription>
            The machine keeps running until {until}, then it is deleted and nothing is charged
            again. You can change your mind until then. The current month is not refunded.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setError(null);
              onConfirm()
                .then(onClose)
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : "Could not cancel the machine");
                })
                .finally(() => setPending(false));
            }}
          >
            {pending ? "Cancelling…" : "Cancel machine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
