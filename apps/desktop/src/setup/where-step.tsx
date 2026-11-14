import { useState, type ReactNode } from "react";
import { Cloud, Laptop, Server } from "lucide-react";
import type { Machine } from "@concors/api-client";
import { useBillingStatus } from "@/billing/use-billing";
import { ConnectServerDialog } from "@/machines/connect-server-dialog";
import { CreateMachineDialog } from "@/machines/create-machine-dialog";
import { formatMonthly, isSoldOut, sizeName } from "@/machines/format";
import { describeMachinesError, useMachines } from "@/machines/use-machines";
import { cn } from "cn";
import { StepFrame } from "./frame";
import type { SetupRecord, SetupWhere } from "./store";

type Open = Extract<SetupRecord, { status: "open" }>;

export interface WhereStepProps {
  record: Open;
  /** Signed in, with the organization a machine is bought for; null for a guest. */
  organization: { id: string; name: string } | null;
  onSignIn: () => void;
  /** Chooses this computer and moves on. */
  onLocal: () => void;
  /** A machine was bought or connected; setup moves on and follows it. */
  onMachine: (where: Exclude<SetupWhere, "local">, machine: Machine) => void;
  /** Keeps the choice, so it is still made after signing in. */
  onChoose: (where: SetupWhere, size?: string) => void;
  onNext: () => void;
  onSkip: () => void;
}

/** First step: where the agents run. This computer, a cloud machine bought here, or one's own server. */
export function WhereStep(props: WhereStepProps) {
  const { record, organization } = props;
  const where = record.where ?? "cloud";
  const common = {
    step: 0,
    title: "Where should your agents run?",
    description:
      "Agents need a machine to work on. Start on this computer, or give them one in the cloud that keeps working while your laptop sleeps. You can add more machines any time.",
    onSkip: props.onSkip,
  };
  // Buying or connecting a machine needs an account; a guest signs in and comes back here.
  if (!organization)
    return (
      <StepFrame
        {...common}
        primary={
          where === "local"
            ? { label: "Continue", onClick: props.onLocal }
            : { label: "Sign in to continue", onClick: props.onSignIn }
        }
      >
        <Choices where={where} onChoose={(next) => props.onChoose(next)}>
          {where !== "local" && (
            <p className="mt-3 text-sm text-muted-foreground">
              {where === "cloud" ? "Buying a cloud machine" : "Connecting your own server"} needs an
              account. Sign in and setup carries on from here.
            </p>
          )}
        </Choices>
      </StepFrame>
    );
  return <SignedInWhere {...props} organization={organization} where={where} />;
}

function SignedInWhere({
  record,
  organization,
  where,
  onLocal,
  onMachine,
  onChoose,
  onNext,
  onSkip,
}: WhereStepProps & { organization: { id: string; name: string }; where: SetupWhere }) {
  const machines = useMachines(organization.id);
  const billing = useBillingStatus(organization.id).data;
  const [buying, setBuying] = useState(false);
  const [connecting, setConnecting] = useState<{ machineId: string; command: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const catalog = machines.catalog;
  const region = catalog?.regions[0]?.id ?? "";
  // The smallest sizes: setup is for a first machine, and every size stays a click away.
  const sizes = (catalog?.sizes ?? []).filter((size) => !isSoldOut(size, region)).slice(0, 3);
  const size = sizes.some((candidate) => candidate.id === record.size) ? record.size : sizes[0]?.id;
  const price = (id: string) =>
    billing?.prices.find((candidate) => candidate.size === id)?.monthlyPrice ??
    catalog?.sizes.find((candidate) => candidate.id === id)?.monthlyPrice ??
    null;
  // A machine from this setup already: carry on with it rather than buy another.
  const chosen = record.machineId && record.where === where;
  const primary = chosen
    ? { label: "Continue", onClick: onNext }
    : where === "local"
      ? { label: "Continue", onClick: onLocal }
      : where === "cloud"
        ? {
            label: "Continue to payment",
            disabled: !catalog || !size,
            onClick: () => setBuying(true),
          }
        : { label: "Connect a server", onClick: () => setAdding(true) };
  return (
    <StepFrame
      step={0}
      title="Where should your agents run?"
      description="Agents need a machine to work on. Start on this computer, or give them one in the cloud that keeps working while your laptop sleeps. You can add more machines any time."
      primary={primary}
      onSkip={onSkip}
    >
      <Choices where={where} onChoose={(next) => onChoose(next, size)}>
        {where === "cloud" && !chosen && (
          <div className="mt-3">
            {machines.error && !catalog ? (
              <p role="alert" className="text-sm text-destructive">
                {machines.error}
              </p>
            ) : !catalog ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading sizes…
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-label="Machine size"
                className="grid gap-2 sm:grid-cols-3"
              >
                {sizes.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    role="radio"
                    aria-checked={candidate.id === size}
                    onClick={() => onChoose("cloud", candidate.id)}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left text-xs",
                      candidate.id === size
                        ? "border-foreground ring-2 ring-foreground/10"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <span className="block text-sm font-semibold">{sizeName(candidate.id)}</span>
                    <span className="text-muted-foreground">
                      {candidate.vcpus} vCPU · {candidate.ramGb} GB
                    </span>
                    <span className="mt-1 block font-medium">
                      {formatMonthly(price(candidate.id))}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Ready in a few minutes. Cancel any time. More sizes and locations on the next screen.
            </p>
          </div>
        )}
        {chosen && (
          <p className="mt-3 text-sm text-muted-foreground">
            {where === "cloud" ? "Your cloud machine is" : "Your server is"} set. Setup follows it
            from here.
          </p>
        )}
      </Choices>
      {buying && catalog && size && (
        <CreateMachineDialog
          organizationId={organization.id}
          organizationName={organization.name}
          catalog={catalog}
          initial={{ name: "cloud", region, size }}
          onCreate={async (input) => {
            const machine = await machines.create(input).catch((cause: unknown) => {
              throw new Error(describeMachinesError(cause));
            });
            onMachine("cloud", machine);
          }}
          onClose={() => setBuying(false)}
        />
      )}
      {(adding || connecting) && (
        <ConnectServerDialog
          organizationName={organization.name}
          machine={
            machines.machines?.find((machine) => machine.id === connecting?.machineId) ?? null
          }
          command={connecting?.command ?? null}
          onRefresh={machines.refreshMachines}
          onAdd={async (name) => {
            const added = await machines.addServer(name).catch((cause: unknown) => {
              throw new Error(describeMachinesError(cause));
            });
            setConnecting({ machineId: added.machine.id, command: added.command });
          }}
          onClose={() => {
            setAdding(false);
            const added = machines.machines?.find(
              (machine) => machine.id === connecting?.machineId,
            );
            setConnecting(null);
            // Closed after adding it: setup follows the server while it finishes connecting.
            if (added) onMachine("server", added);
          }}
        />
      )}
    </StepFrame>
  );
}

function Choices({
  where,
  onChoose,
  children,
}: {
  where: SetupWhere;
  onChoose: (where: SetupWhere) => void;
  children?: ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label="Where agents run" className="space-y-2.5">
      <Choice
        value="local"
        where={where}
        onChoose={onChoose}
        icon={<Laptop className="size-5" />}
        title="This computer"
        badge="Free"
        description="Agents work while Concors is open and this computer is awake. Nothing to set up."
      />
      <Choice
        value="cloud"
        where={where}
        onChoose={onChoose}
        icon={<Cloud className="size-5" />}
        title="A Concors cloud machine"
        badge="Recommended"
        description="A server we set up and look after. Agents keep working around the clock, and you reach them from any device."
      >
        {where === "cloud" && children}
      </Choice>
      <Choice
        value="server"
        where={where}
        onChoose={onChoose}
        icon={<Server className="size-5" />}
        title="Your own server"
        badge="Free"
        description="Run one command on a server you already have, and Concors sets up the rest."
      >
        {where === "server" && children}
      </Choice>
    </div>
  );
}

function Choice({
  value,
  where,
  onChoose,
  icon,
  title,
  badge,
  description,
  children,
}: {
  value: SetupWhere;
  where: SetupWhere;
  onChoose: (where: SetupWhere) => void;
  icon: ReactNode;
  title: string;
  badge: string;
  description: string;
  children?: ReactNode;
}) {
  const selected = where === value;
  return (
    <div
      className={cn(
        "rounded-xl border bg-card px-4 py-3.5 has-[[role=radio]:focus-visible]:ring-2 has-[[role=radio]:focus-visible]:ring-ring",
        selected && "border-foreground ring-2 ring-foreground/5",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => onChoose(value)}
        className="flex w-full items-start gap-3.5 text-left outline-none"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {title}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                badge === "Recommended"
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {badge}
            </span>
          </span>
          <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-[18px] shrink-0 rounded-full border-[1.5px]",
            selected ? "border-[5px] border-foreground" : "border-muted-foreground/40",
          )}
        />
      </button>
      {children && <div className="pl-[50px]">{children}</div>}
    </div>
  );
}
