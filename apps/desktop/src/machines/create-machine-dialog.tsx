import type { MachineCatalog, CreateMachineInput, DevelopmentTools } from "@concors/api-client";
import { ChevronDown, CreditCard, MapPin, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useSshKeys } from "@/data/ssh-keys";
import { api } from "@/auth/api";
import { DevelopmentToolPicker } from "./development-tool-picker";
import { useBilling } from "@/billing/use-billing";
import { openExternal } from "@/tauri";
import { Textarea } from "@/components/ui/textarea";
import { describeMachinesError } from "./use-machines";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  formatMoney,
  formatMonthly,
  isValidMachineName,
  MACHINE_NAME_MAX_LENGTH,
} from "./format.ts";

interface CreateMachineDialogProps {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly catalog: MachineCatalog;
  readonly onCreate: (input: Omit<CreateMachineInput, "organizationId">) => Promise<void>;
  readonly onClose: () => void;
}

export function CreateMachineDialog({
  organizationId,
  organizationName,
  catalog,
  onCreate,
  onClose,
}: CreateMachineDialogProps) {
  const billing = useBilling(organizationId);
  const keys = useSshKeys(organizationId);
  const keyCount = keys.data?.length ?? null;
  const [publicKey, setPublicKey] = useState("");
  const keyError = keys.error ? describeMachinesError(keys.error) : null;
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) {
      headingRef.current?.focus();
      headingRef.current?.closest('[data-slot="vps-form-body"]')?.scrollTo(0, 0);
      previousStep.current = step;
    }
  }, [step]);
  const [tools, setTools] = useState<DevelopmentTools>({ node: "lts", docker: false });
  const [name, setName] = useState("");
  const [region, setRegion] = useState(catalog.regions[0]?.id ?? "");
  const [size, setSize] = useState(catalog.sizes[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenRegion = catalog.regions.find((candidate) => candidate.id === region);
  const chosenSize = catalog.sizes.find((candidate) => candidate.id === size);
  const nameOk = isValidMachineName(name);
  const billed = billing.status?.configured === true;
  const price = billing.status?.prices.find((candidate) => candidate.size === size)?.monthlyPrice;
  const ready =
    nameOk &&
    region !== "" &&
    chosenSize !== undefined &&
    keyCount !== null &&
    (keyCount > 0 || publicKey.trim() !== "") &&
    billing.status !== null &&
    (!billed || (price !== undefined && billing.status.hasPaymentMethod));

  const serverReady =
    nameOk &&
    chosenRegion !== undefined &&
    chosenSize !== undefined &&
    billing.status !== null &&
    (!billed || price !== undefined);
  const customizeReady = keyCount !== null && (keyCount > 0 || publicKey.trim() !== "");
  const busy = pending || billing.opening || billing.checkout !== null;
  const nodeLabel = tools.node === "lts" ? "Latest LTS" : `Node ${tools.node}`;
  const advance = () => {
    if (!busy && ((step === 0 && serverReady) || (step === 1 && customizeReady))) setStep(step + 1);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent size="wide" className="gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b p-6 pr-14">
          <DialogTitle>New VPS</DialogTitle>
          <DialogDescription>
            A server for <span className="font-medium text-foreground">{organizationName}</span>,
            running {catalog.image}.
          </DialogDescription>
          <ol aria-label="Setup steps" className="mt-5 flex items-center gap-4 text-xs">
            {["Server", "Customize", "Review"].map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? "step" : undefined}
                className={`flex items-center gap-2 ${step === index ? "font-medium text-foreground" : "text-muted-foreground"}`}
              >
                <span
                  className={`flex size-6 items-center justify-center rounded-full ${step === index ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  {index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </DialogHeader>
        <form
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            if (step < 2) {
              advance();
              return;
            }
            if (!ready || busy) return;
            setPending(true);
            setError(null);
            void (async () => {
              if (keyCount === 0) {
                const key = await api.addSshKey({
                  organizationId,
                  name: `${name} access`,
                  publicKey: publicKey.trim(),
                });
                keys.resource.set((current) => [...(current ?? []), key]);
              }
              await onCreate({
                name,
                region,
                size,
                ...(catalog.developmentTools ? { developmentTools: tools } : {}),
                ...(billed && price ? { expectedMonthlyPrice: price } : {}),
              });
            })()
              .then(onClose)
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "Could not create the machine");
              })
              .finally(() => setPending(false));
          }}
        >
          <div
            data-slot="vps-form-body"
            className="min-h-0 min-w-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto overscroll-contain p-6"
          >
            <h3 ref={headingRef} tabIndex={-1} className="text-sm font-medium outline-none">
              {["Choose your VPS", "Choose your tools", "Review & deploy"][step]}
            </h3>
            {step === 0 && (
              <>
                <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                  <label className="block min-w-0 space-y-2 text-sm">
                    <span className="block font-medium">Name</span>
                    <Input
                      name="name"
                      aria-label="Name"
                      value={name}
                      onChange={(event) => setName(event.target.value.trim())}
                      placeholder="build-agent"
                      autoFocus
                      required
                      maxLength={MACHINE_NAME_MAX_LENGTH}
                      disabled={pending}
                      aria-invalid={name !== "" && !nameOk}
                      className="h-10"
                    />
                    <span className="block text-xs text-muted-foreground">
                      Lowercase letters, digits and hyphens.
                    </span>
                  </label>
                  <div className="min-w-0 space-y-2 text-sm">
                    <div className="font-medium">Region</div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          aria-label="Region"
                          disabled={pending}
                          className="w-full min-w-0 justify-start font-normal"
                        >
                          <MapPin className="shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {chosenRegion?.location ?? "Choose a region"}
                          </span>
                          <ChevronDown
                            className="shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        sideOffset={6}
                        collisionPadding={16}
                        className="max-h-[min(16rem,var(--radix-dropdown-menu-content-available-height))] p-1.5"
                      >
                        <DropdownMenuRadioGroup
                          aria-label="Region"
                          value={region}
                          onValueChange={setRegion}
                        >
                          {catalog.regions.map((candidate) => (
                            <DropdownMenuRadioItem
                              key={candidate.id}
                              value={candidate.id}
                              className="gap-3 py-2.5 pl-2"
                            >
                              <span
                                aria-hidden="true"
                                className="flex h-7 w-8 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground"
                              >
                                {candidate.countryCode}
                              </span>
                              <span className="min-w-0 break-words">{candidate.location}</span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <p className="text-xs text-muted-foreground">Choose a location close to you.</p>
                  </div>
                </div>
                <fieldset className="min-w-0 space-y-3 text-sm" disabled={pending}>
                  <legend className="font-medium">Server size</legend>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    {catalog.sizes.map((candidate) => {
                      const candidatePrice = billing.status?.prices.find(
                        (price) => price.size === candidate.id,
                      )?.monthlyPrice;
                      const unavailable = billed && !candidatePrice;
                      return (
                        <label
                          key={candidate.id}
                          className="relative flex min-w-0 cursor-pointer flex-col gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/50"
                        >
                          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-2.5">
                              <input
                                type="radio"
                                name="size"
                                value={candidate.id}
                                disabled={unavailable}
                                checked={size === candidate.id}
                                onChange={() => setSize(candidate.id)}
                                className="size-3.5 shrink-0 accent-primary"
                              />
                              <span className="font-medium capitalize">{candidate.id}</span>
                            </span>
                            <span className="text-xs font-medium tabular-nums">
                              {billing.status === null
                                ? "Loading price…"
                                : billed
                                  ? candidatePrice
                                    ? formatMonthly(candidatePrice)
                                    : "Unavailable"
                                  : "Free"}
                            </span>
                          </div>
                          <span className="flex min-w-0 items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                            <Server className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              {candidate.vcpus} vCPU · {candidate.ramGb} GB RAM · {candidate.diskGb}{" "}
                              GB disk
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </>
            )}
            {step === 1 && (
              <>
                {catalog.developmentTools ? (
                  <DevelopmentToolPicker
                    tools={tools}
                    catalog={catalog.developmentTools}
                    onChange={setTools}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Optional development tool setup is unavailable right now. You can install tools
                    from the terminal after deployment.
                  </p>
                )}
                {keyCount === 0 && (
                  <label className="block space-y-2 text-sm">
                    <span className="block font-medium">SSH public key</span>
                    <Textarea
                      className="max-h-32 min-h-20 resize-y font-mono text-xs [overflow-wrap:anywhere]"
                      aria-label="SSH public key"
                      value={publicKey}
                      disabled={pending}
                      onChange={(event) => setPublicKey(event.target.value)}
                      placeholder="ssh-ed25519 AAAA…"
                      required
                    />
                    <span className="block text-xs text-muted-foreground">
                      Paste your public key to access the VPS. It will be saved to this workspace.
                    </span>
                  </label>
                )}
                {keyCount === null && !keyError && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Loading SSH keys…
                  </p>
                )}
                {keyError && (
                  <p role="alert" className="text-sm break-words text-destructive">
                    {keyError}
                  </p>
                )}
                {keyCount === null && keyError && (
                  <Button type="button" variant="ghost" onClick={() => void keys.refresh()}>
                    Retry loading SSH keys
                  </Button>
                )}
              </>
            )}
            {step === 2 && (
              <>
                <div className="space-y-4 rounded-lg border p-4 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium break-all">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        {chosenRegion?.location} · <span className="capitalize">{size}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {chosenSize?.vcpus} vCPU · {chosenSize?.ramGb} GB RAM · {chosenSize?.diskGb}{" "}
                        GB disk
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setStep(0)}
                      aria-label="Edit server"
                    >
                      Edit
                    </Button>
                  </div>
                  <div className="flex items-start justify-between gap-4 border-t pt-4">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">Development tools</p>
                      <p className="text-xs text-muted-foreground">
                        {catalog.developmentTools
                          ? [
                              tools.node ? `Node.js (${nodeLabel}), npm, pnpm, Yarn` : null,
                              tools.python ? "Python & uv" : null,
                              tools.go ? "Go" : null,
                              tools.rust ? "Rust & Cargo" : null,
                              tools.docker ? "Docker & Compose" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "No optional tools selected"
                          : "No optional tools selected"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setStep(1)}
                      aria-label="Edit customization"
                    >
                      Edit
                    </Button>
                  </div>
                </div>
                <section
                  aria-label="Order summary"
                  className="min-w-0 space-y-4 border-t pt-5 text-sm"
                >
                  <h3 className="text-xs font-medium text-muted-foreground">Order summary</h3>
                  <div className="flex min-w-0 items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/30">
                        <Server className="size-4 text-muted-foreground" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium">
                          <span className="capitalize">{chosenSize?.id}</span> VPS
                        </p>
                        <p className="text-xs break-words text-muted-foreground">
                          {chosenRegion?.location}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {!billing.status ? (
                        <span role="status" className="text-xs text-muted-foreground">
                          Loading price…
                        </span>
                      ) : !billed ? (
                        <span className="text-xl font-semibold">Free</span>
                      ) : price ? (
                        <p className="whitespace-nowrap">
                          <span className="text-xl font-semibold tracking-tight tabular-nums">
                            {formatMoney(price)}
                          </span>
                          <span className="ml-1 text-xs text-muted-foreground">/ month</span>
                        </p>
                      ) : (
                        <span className="text-xs text-muted-foreground">Unavailable</span>
                      )}
                    </div>
                  </div>
                  {!billing.status && billing.error && (
                    <Button type="button" variant="outline" size="sm" onClick={billing.refresh}>
                      Reload billing
                    </Button>
                  )}
                  {billed && (
                    <>
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <CreditCard
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          {billing.status?.card ? (
                            <span className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="capitalize">{billing.status.card.brand}</span>
                              <span className="text-muted-foreground">
                                •••• {billing.status.card.last4}
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {billing.status?.hasPaymentMethod
                                ? "Card on file"
                                : "No payment method"}
                            </span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant={billing.status?.hasPaymentMethod ? "ghost" : "outline"}
                          size="sm"
                          disabled={pending || billing.opening || billing.checkout !== null}
                          onClick={() => void billing.addCard()}
                        >
                          {billing.opening
                            ? "Opening…"
                            : billing.status?.hasPaymentMethod
                              ? "Change"
                              : "Add a card with Stripe"}
                        </Button>
                      </div>
                      {billing.checkout ? (
                        <div role="status" className="space-y-2 text-xs text-muted-foreground">
                          <p>
                            Complete card setup in your browser, then return here to pay and create
                            your VPS.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              onClick={() => {
                                if (billing.checkout) void openExternal(billing.checkout.url);
                              }}
                            >
                              Open Stripe again
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={billing.stopWaiting}
                            >
                              Back to payment
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          First month charged on creation. Renews automatically each month.
                        </p>
                      )}
                    </>
                  )}
                </section>
              </>
            )}
            {step === 0 && !billing.status && billing.error && (
              <Button type="button" variant="outline" onClick={billing.refresh}>
                Reload billing
              </Button>
            )}
            {billing.error && (
              <p role="alert" className="text-sm break-words text-destructive">
                {billing.error}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm break-words text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="mx-0 mb-0 min-w-0 flex-row items-center justify-end rounded-none">
            <Button
              type="button"
              variant="ghost"
              onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
              disabled={busy}
            >
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            <Button
              type="submit"
              className="min-w-0"
              disabled={busy || (step === 0 ? !serverReady : step === 1 ? !customizeReady : !ready)}
            >
              {step < 2
                ? "Continue"
                : pending
                  ? "Deploying…"
                  : billed && price
                    ? `Pay ${formatMoney(price)} & deploy`
                    : "Deploy VPS"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
