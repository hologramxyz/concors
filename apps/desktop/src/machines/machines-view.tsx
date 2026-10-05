import { MachineIcon } from "./machine-icon";
import { MachineIconPicker } from "./machine-icon-picker";
import type { DaemonUpdate, Machine } from "@concors/api-client";
import { cn } from "cn";
import {
  CalendarX,
  Check,
  CircleAlert,
  ChevronDown,
  CircleArrowUp,
  Cloud,
  Copy,
  KeyRound,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Server,
  RotateCcw,
  Settings2,
  Terminal,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { useBillingStatus } from "@/billing/use-billing";
import { PaymentFailedWarning } from "@/billing/payment-failed-warning";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib/clipboard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { DaemonDetails, type DaemonConnectionInfo } from "./daemon-details.tsx";
import { MachineUsage } from "./machine-usage.tsx";
import { RenameMachineDialog } from "./rename-machine-dialog.tsx";
import { CreateMachineDialog, type MachineDraft } from "./create-machine-dialog.tsx";
import { ConnectServerDialog } from "./connect-server-dialog.tsx";
import {
  describeEnding,
  describeStatus,
  formatMonthly,
  isExternal,
  isRelayed,
  isUndeployed,
  sshCommand,
  STATUS_TONE,
  type StatusTone,
} from "./format.ts";
import { describeMachinesError, useMachines } from "./use-machines.ts";
import { useDeviceSsh, type DeviceSsh } from "./device-ssh.ts";
import { SettingsSectionHeader } from "@/views/settings-primitives";

export interface MachinesViewProps {
  readonly auth: SignedInAuth;
  readonly onSelectLocal?: () => void;
  readonly localSelected?: boolean;
  readonly focusedMachineId?: string | null;
  /** The machine the app is connected to (`local` for this computer) and that connection. */
  readonly selectedMachineId?: string;
  readonly connection?: DaemonConnectionInfo;
}

/** Cloud machines of the active organization: list, create, rename, cancel, and how to connect. */
export function MachinesView({
  auth,
  onSelectLocal,
  localSelected = false,
  focusedMachineId,
  selectedMachineId,
  connection,
}: MachinesViewProps) {
  const organization = activeOrganization(auth);
  const state = useMachines(organization?.id);
  const ssh = useDeviceSsh(organization?.id);
  const billing = useBillingStatus(organization?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<MachineDraft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Machine | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** The own-server dialog: the machine it connects once added, and its command when known. */
  const [connecting, setConnecting] = useState<{
    machineId: string | null;
    command: string | null;
  } | null>(null);

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
  const remove = (machine: Machine) => {
    setRemoving(machine.id);
    setActionError(null);
    return state
      .cancel(machine.id)
      .then(
        () => true,
        (cause: unknown) => {
          setActionError(describeMachinesError(cause));
          return false;
        },
      )
      .finally(() => setRemoving(null));
  };
  const atRisk =
    state.machines === null
      ? null
      : machines.filter((machine) => machine.status !== "deleted" && !isExternal(machine)).length;
  const newVps = () => {
    setDraft(null);
    setCreating(true);
  };
  const connectServer = () => setConnecting({ machineId: null, command: null });
  const showConnectCommand = (machine: Machine) => {
    setActionError(null);
    void state.connectCommand(machine.id).then(
      ({ command }) => setConnecting({ machineId: machine.id, command }),
      (cause: unknown) => setActionError(describeMachinesError(cause)),
    );
  };

  return (
    <section
      data-machines-view
      aria-label="Machines"
      className="flex w-full min-w-0 flex-col [overflow-wrap:anywhere]"
    >
      <SettingsSectionHeader
        title="Machines"
        description="Manage this computer and your cloud development machines."
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={state.reload}
              disabled={state.loading}
              aria-label="Refresh"
            >
              <RefreshCw className={cn(state.loading && "animate-spin")} aria-hidden="true" />
            </Button>
            <NewMachineMenu
              variant="outline"
              size="sm"
              disabled={state.catalog === null || !organization}
              onNewVps={newVps}
              onConnectServer={connectServer}
            />
          </>
        }
      />
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
          className="mb-5 overflow-hidden rounded-xl border bg-card/40"
          aria-label="Local machine"
        >
          <div className="flex flex-col items-start justify-between gap-4 p-5 md:flex-row md:items-center md:p-6">
            <div className="flex min-w-0 items-center gap-3">
              <MachineIcon local className="size-6 text-muted-foreground" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-base font-semibold">This computer</h3>
                  <Badge variant="outline" className={BADGE_TONE_CLASS.info}>
                    Local
                  </Badge>
                  {localSelected && <Badge variant="secondary">Current</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your local files, terminals, and agents.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={onSelectLocal}>
              {localSelected ? "Open workspace" : "Use this computer"}
            </Button>
          </div>
          <AdvancedDetails>
            <DaemonDetails connection={localSelected ? connection : undefined} />
          </AdvancedDetails>
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
          <NewMachineMenu
            disabled={state.catalog === null || !organization}
            onNewVps={newVps}
            onConnectServer={connectServer}
          />
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
                connection={selectedMachineId === machine.id ? connection : undefined}
                paymentFailed={billing.data?.paymentFailedAt != null}
                onRename={(name) => state.rename(machine.id, name)}
                onIconChange={(icon) => state.setIcon(machine.id, icon)}
                location={
                  isExternal(machine)
                    ? "Your own server"
                    : (state.catalog?.regions.find((region) => region.id === machine.region)
                        ?.location ?? readableRegion(machine.region))
                }
                onCancel={() => setCancelling(machine)}
                onShowConnectCommand={() => showConnectCommand(machine)}
                onUpdateDaemon={() =>
                  state.updateDaemon(machine.id).catch((cause: unknown) => {
                    throw new Error(describeMachinesError(cause));
                  })
                }
                removing={removing === machine.id}
                onRemove={() => void remove(machine)}
                onRetry={() => {
                  void remove(machine).then((removed) => {
                    if (!removed) return;
                    setDraft({ name: machine.name, region: machine.region, size: machine.size });
                    setCreating(true);
                  });
                }}
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
          initial={draft}
          onCreate={async (input) => {
            await state.create(input).catch((cause: unknown) => {
              throw new Error(describeMachinesError(cause));
            });
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {connecting && organization && (
        <ConnectServerDialog
          organizationName={organization.name}
          machine={machines.find((machine) => machine.id === connecting.machineId) ?? null}
          command={connecting.command}
          onAdd={async (name) => {
            const added = await state.addServer(name).catch((cause: unknown) => {
              throw new Error(describeMachinesError(cause));
            });
            setConnecting({ machineId: added.machine.id, command: added.command });
          }}
          onClose={() => setConnecting(null)}
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
    </section>
  );
}

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground/50",
  pending: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-destructive",
};

/** Same palette as invoice statuses in Settings → Billing. */
const BADGE_TONE_CLASS: Record<StatusTone | "info", string> = {
  neutral: "border-border bg-muted/50 text-muted-foreground",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

function MachineCard({
  machine,
  ssh,
  connection,
  paymentFailed,
  location,
  onRename,
  onIconChange,
  onCancel,
  onShowConnectCommand,
  onUpdateDaemon,
  onResume,
  resuming,
  onRemove,
  onRetry,
  removing,
}: {
  readonly machine: Machine;
  readonly ssh: DeviceSsh;
  /** Set only while this is the machine the app is connected to. */
  readonly connection: DaemonConnectionInfo | undefined;
  /** The organization's card is failing, so this machine is on Stripe's retry clock. */
  readonly paymentFailed: boolean;
  readonly location: string;
  readonly onRename: (name: string) => Promise<void>;
  readonly onIconChange: (icon: string | null) => Promise<void>;
  readonly onCancel: () => void;
  /** For the person's own server still waiting to connect: shows a new setup command. */
  readonly onShowConnectCommand: () => void;
  /** Installs the pending daemon update now; the owner has confirmed. Rejects with a message. */
  readonly onUpdateDaemon: () => Promise<void>;
  readonly onResume: () => void;
  readonly resuming: boolean;
  /** Only offered for machines that were never deployed. */
  readonly onRemove: () => void;
  readonly onRetry: () => void;
  readonly removing: boolean;
}) {
  const tone = STATUS_TONE[machine.status];
  // No server and no bill: nothing ends, renews or can be connected to.
  const undeployed = isUndeployed(machine);
  const ending = undeployed ? null : describeEnding(machine);
  // The person's own server: no region, size, price or renewal, and removing it is immediate.
  const external = isExternal(machine);
  return (
    <div className="overflow-hidden rounded-xl border bg-card/40">
      <div className="p-5 sm:p-6">
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
              <h3 className="min-w-0 text-base font-semibold break-all">{machine.name}</h3>
              {!undeployed && <RenameMachineDialog machine={machine} onRename={onRename} />}
              <Badge variant="outline" className={BADGE_TONE_CLASS[tone]}>
                {undeployed ? "Not deployed" : describeStatus(machine)}
              </Badge>
              {connection && <Badge variant="secondary">Current</Badge>}
              {ending && <Badge variant="secondary">{ending}</Badge>}
              {paymentFailed &&
                !ending &&
                !undeployed &&
                !external &&
                machine.status !== "deleted" && (
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
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {external ? (
                <span className="inline-flex items-center gap-1.5">
                  <Server className="size-3.5 shrink-0" aria-hidden="true" />
                  {location}
                </span>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5" title={machine.region}>
                    <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                    {location}
                  </span>
                  <span className="inline-flex items-center gap-1.5 capitalize">
                    <Server className="size-3.5 shrink-0" aria-hidden="true" />
                    {machine.size}
                  </span>
                  {!undeployed && <span>{formatMonthly(machine.monthlyPrice)}</span>}
                </>
              )}
            </div>
          </div>
          {undeployed ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onRemove} disabled={removing}>
                <Trash2 data-icon="inline-start" aria-hidden="true" />
                Remove
              </Button>
              <Button variant="outline" size="sm" onClick={onRetry} disabled={removing}>
                <RotateCcw data-icon="inline-start" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : ending ? (
            <Button variant="outline" size="sm" onClick={onResume} disabled={resuming}>
              <Undo2 data-icon="inline-start" aria-hidden="true" />
              {resuming ? "Resuming…" : "Keep machine"}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCancel}
              aria-label={`${external ? "Remove" : "Cancel"} ${machine.name}`}
            >
              {external ? <Trash2 aria-hidden="true" /> : <CalendarX aria-hidden="true" />}
            </Button>
          )}
        </div>
      </div>

      {machine.lastError && !undeployed && (
        <p role="alert" className="selectable mx-5 mb-5 text-xs text-destructive sm:mx-6 sm:mb-6">
          {machine.lastError}
        </p>
      )}

      {machine.daemonUpdate && machine.status === "running" && !undeployed && (
        <DaemonUpdateNotice
          machine={machine}
          update={machine.daemonUpdate}
          onUpdate={onUpdateDaemon}
        />
      )}

      {undeployed ? (
        <div className="border-t p-5 sm:p-6">
          <div role="status" className="flex items-start gap-3 rounded-lg bg-destructive/5 p-4">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">This machine couldn't be deployed</p>
              <p className="text-sm text-muted-foreground">
                The order didn't go through, so no server was created
                {machine.monthlyPrice ? " and its payment was refunded" : ""}. Try again to pick
                another region or size, or remove it.
              </p>
            </div>
          </div>
        </div>
      ) : external && machine.status === "provisioning" ? (
        <div className="border-t p-5 sm:p-6">
          <div role="status" className="flex items-start gap-3 rounded-lg bg-muted/30 p-4">
            <LoaderCircle
              className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Waiting for your server</p>
                <p className="text-sm text-muted-foreground">
                  Run the setup command on your server to connect it.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={onShowConnectCommand}>
                <Terminal data-icon="inline-start" aria-hidden="true" />
                Show setup command
              </Button>
            </div>
          </div>
        </div>
      ) : machine.status === "provisioning" ? (
        <div className="border-t p-5 sm:p-6">
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
                  Renews on{" "}
                  {new Date(machine.paidUntil).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-6 border-t p-5 sm:p-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-10">
          <dl className="grid content-start gap-5 text-xs sm:grid-cols-2 lg:grid-cols-1">
            <div>
              <dt className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Address
              </dt>
              {isRelayed(machine) ? (
                <dd>Through the Concors relay</dd>
              ) : (
                <dd className="selectable font-mono break-all">{machine.ipv4 ?? "Assigning…"}</dd>
              )}
            </div>
            {machine.paidUntil && (
              <div>
                <dt className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {ending ? "Available until" : "Renews on"}
                </dt>
                <dd>
                  {new Date(machine.paidUntil).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}
                </dd>
              </div>
            )}
          </dl>
          <MachineUsage machine={machine} />
        </div>
      )}
      {!undeployed && (
        <AdvancedDetails>
          <div className="space-y-4">
            <DaemonDetails
              connection={connection}
              reportedVersion={machine.agentVersion}
              seenAt={machine.agentSeenAt}
              error={machine.agentError}
            />
            <div>
              <p className="mb-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                SSH access
              </p>
              <SshAccess machine={machine} ssh={ssh} />
            </div>
          </div>
        </AdvancedDetails>
      )}
    </div>
  );
}

/**
 * A newer daemon is waiting for this machine. The control plane installs it once no agent is
 * working or waiting, so the owner only needs to act to get it sooner, at the cost of whatever the
 * agents are doing right now.
 */
function DaemonUpdateNotice({
  machine,
  update,
  onUpdate,
}: {
  readonly machine: Machine;
  readonly update: DaemonUpdate;
  readonly onUpdate: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (update.installing)
    return (
      <div
        role="status"
        className="mx-5 mb-5 flex items-start gap-3 rounded-lg bg-muted/30 p-4 sm:mx-6 sm:mb-6"
      >
        <LoaderCircle
          className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">Updating to version {update.version}</p>
          <p className="text-sm text-muted-foreground">
            This machine's agents restart when the update is installed. Your conversations are kept.
          </p>
        </div>
      </div>
    );
  return (
    <div
      role="group"
      aria-label="Update available"
      className="mx-5 mb-5 flex flex-col items-start gap-3 rounded-lg bg-sky-500/5 p-4 sm:mx-6 sm:mb-6 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <CircleArrowUp
          className="mt-0.5 size-4 shrink-0 text-sky-700 dark:text-sky-400"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">Update available: version {update.version}</p>
          <p className="text-sm text-muted-foreground">
            It installs by itself when no agent on this machine is working or waiting for you.
          </p>
        </div>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          if (next) setError(null);
          setOpen(next);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0">
            Update now
          </Button>
        </DialogTrigger>
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>Update {machine.name} now?</DialogTitle>
            <DialogDescription>
              Updating restarts this machine's agents. Anything they're doing right now will stop;
              your conversations are kept.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm break-words text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Not now
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setPending(true);
                setError(null);
                onUpdate()
                  .then(() => setOpen(false))
                  .catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : "Could not start the update");
                  })
                  .finally(() => setPending(false));
              }}
            >
              {pending ? "Starting update…" : "Update now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The collapsed footer of a machine card: the daemon behind it and how to reach it. */
function AdvancedDetails({ children }: { readonly children: ReactNode }) {
  return (
    <details className="group border-t">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-xs text-muted-foreground transition-colors select-none hover:bg-muted/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <Settings2 className="size-3.5" aria-hidden="true" />
          Advanced
        </span>
        <ChevronDown
          className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t bg-muted/10 px-5 py-4 sm:px-6">{children}</div>
    </details>
  );
}

/** Buy a VPS from Concors, or connect a server the person already has. */
function NewMachineMenu({
  variant,
  size,
  disabled,
  onNewVps,
  onConnectServer,
}: {
  readonly variant?: "outline";
  readonly size?: "sm";
  readonly disabled: boolean;
  readonly onNewVps: () => void;
  readonly onConnectServer: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          New machine
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-72 p-1.5">
        <DropdownMenuItem onSelect={onNewVps} className="items-start gap-3 py-2">
          <Cloud className="mt-0.5" aria-hidden="true" />
          <span className="space-y-0.5">
            <span className="block font-medium">New VPS</span>
            <span className="block text-xs text-muted-foreground">
              From Concors, billed monthly
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onConnectServer} className="items-start gap-3 py-2">
          <Server className="mt-0.5" aria-hidden="true" />
          <span className="space-y-0.5">
            <span className="block font-medium">Connect your own server</span>
            <span className="block text-xs text-muted-foreground">Run one command on it, free</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function readableRegion(region: string): string {
  return region
    .split("-")
    .map((part) => (part.length <= 2 ? part : `${part[0]}${part.slice(1).toLowerCase()}`))
    .join(" ");
}

/**
 * How to reach this machine from a terminal. Using a machine in Concors never needs SSH; this is
 * for people who want plain `ssh`. The desktop app sets up a key for this computer on request,
 * elsewhere a command appears once the person has added a key of their own in Settings.
 */
function SshAccess({ machine, ssh }: { readonly machine: Machine; readonly ssh: DeviceSsh }) {
  if (isRelayed(machine))
    return (
      <span className="text-muted-foreground">
        This server is reached through the Concors relay, so plain SSH from this computer doesn't
        reach it. Use your own way in, or the terminal in Concors.
      </span>
    );
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
  const external = isExternal(machine);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {external ? "Remove" : "Cancel"} {machine.name}?
          </DialogTitle>
          <DialogDescription>
            {external
              ? "Concors stops its services on the server and removes its access. The server itself, your files and your own SSH keys stay as they are."
              : `The machine keeps running until ${until}, then it is deleted and nothing is charged again. You can change your mind until then. The current month is not refunded.`}
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
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : `Could not ${external ? "remove" : "cancel"} the machine`,
                  );
                })
                .finally(() => setPending(false));
            }}
          >
            {external
              ? pending
                ? "Removing…"
                : "Remove machine"
              : pending
                ? "Cancelling…"
                : "Cancel machine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
