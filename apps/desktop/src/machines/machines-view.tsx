import { MachineIcon } from "./machine-icon";
import { MachineIconPicker } from "./machine-icon-picker";
import { DevelopmentToolsStatus } from "./development-tools-status";
import type { Machine } from "@concors/api-client";
import { cn } from "cn";
import {
  CalendarX,
  Check,
  Cloud,
  Copy,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { useBillingStatus } from "@/billing/use-billing";
import { PaymentFailedWarning } from "@/billing/payment-failed-warning";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyText } from "@/lib/clipboard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { MachineUsage } from "./machine-usage.tsx";
import { RenameMachineDialog } from "./rename-machine-dialog.tsx";
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
import { useDeviceSsh, type DeviceSsh } from "./device-ssh.ts";

export interface MachinesViewProps {
  readonly auth: SignedInAuth;
  readonly onSelectLocal?: () => void;
  readonly localSelected?: boolean;
  readonly focusedMachineId?: string | null;
}

/** Cloud machines of the active organization: list, create, rename, cancel, and how to connect. */
export function MachinesView({
  auth,
  onSelectLocal,
  localSelected = false,
  focusedMachineId,
}: MachinesViewProps) {
  const organization = activeOrganization(auth);
  const state = useMachines(organization?.id);
  const ssh = useDeviceSsh(organization?.id);
  const billing = useBillingStatus(organization?.id ?? "");
  const [creating, setCreating] = useState(false);
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
  // Every machine is its own subscription on the same card, so a failed payment puts all of the
  // ones still running at risk. `null` while the list is loading keeps the warning plural.
  const atRisk =
    state.machines === null
      ? null
      : machines.filter((machine) => machine.status !== "deleted").length;

  return (
    <div data-machines-view className="flex w-full min-w-0 flex-col">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Machines</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your computers and cloud development machines.
          </p>
          <p className="mt-1 text-xs break-words text-muted-foreground">
            {organization?.name ?? "Your organization"} · Billed monthly
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={state.reload}
            disabled={state.loading}
            aria-label="Refresh"
          >
            <RefreshCw className={cn(state.loading && "animate-spin")} aria-hidden="true" />
          </Button>
          <Button
            onClick={() => setCreating(true)}
            disabled={state.catalog === null || !organization}
          >
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
          <Button type="button" variant="ghost" onClick={() => setActionError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <PaymentFailedWarning
        className="mb-5"
        organizationId={organization?.id}
        paymentFailedAt={billing.data?.paymentFailedAt ?? null}
        atRisk={atRisk}
        onReturn={() => void billing.refresh()}
      />

      {onSelectLocal && (
        <div
          className="mb-5 flex flex-col items-start justify-between gap-4 rounded-xl border bg-card/40 p-5 sm:flex-row sm:items-center sm:p-6"
          aria-label="Local machine"
        >
          <div className="flex min-w-0 items-center gap-3">
            <MachineIcon local className="size-6 text-muted-foreground" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="text-lg font-semibold">This computer</h3>
                <Badge variant="outline">Local</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Your local files, terminals, and agents.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={onSelectLocal}>
            {localSelected ? "Open workspace" : "Use this computer"}
          </Button>
        </div>
      )}

      {state.machines === null && !state.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading machines…
        </p>
      ) : empty ? (
        <div className="flex min-h-80 flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-card/40 p-8 text-center">
          <Cloud className="size-10 text-muted-foreground/50" aria-hidden="true" />
          <h3 className="text-lg font-medium">No cloud machines yet</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create a machine to run agents, clone repositories, and keep your work in one place.
          </p>
          <Button
            onClick={() => setCreating(true)}
            disabled={state.catalog === null || !organization}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            New machine
          </Button>
        </div>
      ) : (
        <ul aria-label="Cloud machines" className="flex flex-col gap-5">
          {machines.map((machine) => (
            <li
              key={machine.id}
              id={`cloud-machine-${machine.id}`}
              className={cn(machine.id === focusedMachineId && "rounded-lg ring-2 ring-primary/40")}
            >
              <MachineCard
                machine={machine}
                ssh={ssh}
                paymentFailed={billing.data?.paymentFailedAt != null}
                onRename={(name) => state.rename(machine.id, name)}
                onIconChange={(icon) => state.setIcon(machine.id, icon)}
                onRetryTools={() => state.retryTools(machine.id)}
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
  ssh,
  paymentFailed,
  onRename,
  onIconChange,
  onRetryTools,
  onCancel,
  onResume,
  resuming,
}: {
  readonly machine: Machine;
  readonly ssh: DeviceSsh;
  /** The organization's card is failing, so this machine is on Stripe's retry clock. */
  readonly paymentFailed: boolean;
  readonly onRename: (name: string) => Promise<void>;
  readonly onIconChange: (icon: string | null) => Promise<void>;
  readonly onRetryTools: () => Promise<void>;
  readonly onCancel: () => void;
  readonly onResume: () => void;
  readonly resuming: boolean;
}) {
  const tone = STATUS_TONE[machine.status];
  const ending = describeEnding(machine);
  return (
    <div className="rounded-xl border bg-card/40 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <MachineIconPicker machine={machine} onSave={onIconChange} />
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                TONE_CLASS[tone],
                tone === "pending" && "animate-pulse",
              )}
              aria-hidden="true"
            />
            <h3 className="min-w-0 text-lg font-semibold break-all">{machine.name}</h3>
            <RenameMachineDialog machine={machine} onRename={onRename} />
            <Badge variant="outline">{describeStatus(machine)}</Badge>
            {ending && <Badge variant="secondary">{ending}</Badge>}
            {paymentFailed && !ending && machine.status !== "deleted" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive">At risk</Badge>
                </TooltipTrigger>
                <TooltipContent>
                  This machine is deleted, with everything on it, if the payment keeps failing.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
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

      {machine.status === "provisioning" ? (
        <div className="mt-6 border-t pt-5">
          <div role="status" className="flex items-start gap-3 rounded-lg bg-muted/30 p-4">
            <LoaderCircle
              className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">
                {machine.ovhState === "order:documentsRequested"
                  ? "Waiting for provider review"
                  : "Setting up your machine"}
              </p>
              <p className="text-sm text-muted-foreground">
                {machine.ovhState === "order:documentsRequested"
                  ? "The provider needs to review this order before setup can continue."
                  : "Your server is being prepared. Connection details and usage will appear here as they become available."}
              </p>
            </div>
          </div>
          {(machine.ipv4 || machine.paidUntil) && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
              {machine.ipv4 && (
                <p>
                  Address <span className="selectable ml-2 font-mono">{machine.ipv4}</span>
                </p>
              )}
              {machine.paidUntil && (
                <p className="ml-auto">
                  Paid until{" "}
                  {new Date(machine.paidUntil).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-6 border-t pt-5 lg:grid-cols-2 lg:gap-10">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] content-start items-center gap-x-5 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Address</dt>
            <dd className="selectable font-mono break-all">{machine.ipv4 ?? "assigning…"}</dd>
            <dt className="text-muted-foreground">SSH</dt>
            <dd className="min-w-0">
              <SshAccess machine={machine} ssh={ssh} />
            </dd>
            {machine.paidUntil && (
              <>
                <dt className="text-muted-foreground">Paid until</dt>
                <dd>
                  {new Date(machine.paidUntil).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}
                </dd>
              </>
            )}
          </dl>
          <MachineUsage machine={machine} />
        </div>
      )}
      <DevelopmentToolsStatus machine={machine} onRetry={onRetryTools} />
    </div>
  );
}

/**
 * How to reach this machine from a terminal. Using a machine in Concors never needs SSH; this is
 * for people who want plain `ssh`. The desktop app sets up a key for this computer on request,
 * elsewhere a command appears once the person has added a key of their own in Settings.
 */
function SshAccess({ machine, ssh }: { readonly machine: Machine; readonly ssh: DeviceSsh }) {
  const plain = sshCommand(machine);
  if (plain === null) return <span className="text-muted-foreground">—</span>;

  if (ssh.supported) {
    if (ssh.registered && ssh.key) {
      const command = sshCommand(machine, ssh.key.path) ?? plain;
      return (
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <code className="selectable font-mono break-all">{command}</code>
            <CopyButton text={command} />
          </div>
          {ssh.justRegistered && (
            <p role="status" className="text-xs text-muted-foreground">
              Your key reaches this machine within a few seconds.
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <Button variant="outline" size="sm" disabled={ssh.settingUp} onClick={ssh.setUp}>
          <KeyRound data-icon="inline-start" aria-hidden="true" />
          {ssh.settingUp ? "Setting up…" : "Set up SSH on this computer"}
        </Button>
        {ssh.error ? (
          <p role="alert" className="text-xs break-words text-destructive">
            {ssh.error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only needed to connect from your own terminal.
          </p>
        )}
      </div>
    );
  }

  if (ssh.hasKeys)
    return (
      <div className="flex min-w-0 items-center gap-2">
        <code className="selectable font-mono break-all">{plain}</code>
        <CopyButton text={plain} />
      </div>
    );
  return (
    <span className="text-muted-foreground">
      Add an SSH key in Settings to connect from your own terminal.
    </span>
  );
}

function CopyButton({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={error ? "Copy failed; try again" : "Copy SSH command"}
      title={
        error
          ? "Could not copy. Select the SSH command and copy it manually."
          : copied
            ? "Copied"
            : "Copy SSH command"
      }
      onClick={() => {
        void copyText(text).then(
          () => {
            setCopied(true);
            setError(false);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {
            setCopied(false);
            setError(true);
          },
        );
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
