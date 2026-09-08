import type { MachineCatalog } from "@concors/api-client";
import { useState } from "react";

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

import { formatMonthly, isValidMachineName, MACHINE_NAME_MAX_LENGTH } from "./format.ts";

interface CreateMachineDialogProps {
  readonly catalog: MachineCatalog;
  readonly onCreate: (input: { name: string; region: string; size: string }) => Promise<void>;
  readonly onClose: () => void;
}

export function CreateMachineDialog({ catalog, onCreate, onClose }: CreateMachineDialogProps) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState(catalog.regions[0]?.id ?? "");
  const [size, setSize] = useState(catalog.sizes[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenSize = catalog.sizes.find((candidate) => candidate.id === size);
  const nameOk = isValidMachineName(name);
  const billed = catalog.sizes.some((candidate) => candidate.monthlyPrice !== null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New machine</DialogTitle>
          <DialogDescription>
            A server of your own, running {catalog.image}. It is charged monthly in advance and
            ready in a few minutes; your organization’s SSH keys are installed on it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!nameOk) return;
            setPending(true);
            setError(null);
            onCreate({ name, region, size })
              .then(onClose)
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "Could not create the machine");
              })
              .finally(() => setPending(false));
          }}
        >
          <label className="block space-y-2 text-sm">
            <span>Name</span>
            <Input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value.trim())}
              placeholder="build-agent"
              autoFocus
              required
              maxLength={MACHINE_NAME_MAX_LENGTH}
              disabled={pending}
              aria-invalid={name !== "" && !nameOk}
            />
            <span className="block text-xs text-muted-foreground">
              Lowercase letters, digits and hyphens.
            </span>
          </label>
          <label className="block space-y-2 text-sm">
            <span>Region</span>
            <select
              aria-label="Region"
              value={region}
              disabled={pending}
              onChange={(event) => setRegion(event.target.value)}
              className="w-full rounded border bg-background px-3 py-2"
            >
              {catalog.regions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.location}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="space-y-2 text-sm" disabled={pending}>
            <legend>Size</legend>
            <div className="grid gap-2">
              {catalog.sizes.map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-accent"
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="size"
                      value={candidate.id}
                      checked={size === candidate.id}
                      onChange={() => setSize(candidate.id)}
                    />
                    <span>
                      <span className="font-medium capitalize">{candidate.id}</span>
                      <span className="block text-xs text-muted-foreground">
                        {candidate.vcpus} vCPU · {candidate.ramGb} GB RAM · {candidate.diskGb} GB
                        disk
                      </span>
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {billed ? formatMonthly(candidate.monthlyPrice) : "Free"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !nameOk || chosenSize === undefined}>
              {pending
                ? "Creating…"
                : billed && chosenSize?.monthlyPrice
                  ? `Create for ${formatMonthly(chosenSize.monthlyPrice)}`
                  : "Create machine"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
