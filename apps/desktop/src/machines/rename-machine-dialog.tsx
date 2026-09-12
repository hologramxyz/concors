import type { Machine } from "@concors/api-client";
import { Pencil } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { isValidMachineName, MACHINE_NAME_MAX_LENGTH } from "./format.ts";
import { describeMachinesError } from "./use-machines.ts";

export function RenameMachineDialog({
  machine,
  onRename,
}: {
  readonly machine: Machine;
  readonly onRename: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(machine.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const valid = isValidMachineName(name);
  const canSave = valid && name !== machine.name && !pending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setName(machine.name);
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Rename ${machine.name}`}
          title="Rename machine"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-md"
        showCloseButton={!pending}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename machine</DialogTitle>
          <DialogDescription>Choose a name to recognize this machine.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            setPending(true);
            setError(null);
            void onRename(name)
              .then(() => setOpen(false))
              .catch((cause: unknown) => setError(describeMachinesError(cause)))
              .finally(() => setPending(false));
          }}
        >
          <div className="space-y-2">
            <label htmlFor={id} className="text-sm font-medium">
              Machine name
            </label>
            <Input
              ref={inputRef}
              id={id}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              maxLength={MACHINE_NAME_MAX_LENGTH}
              disabled={pending}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={!valid || !!error}
              aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
            />
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              Use 1–63 lowercase letters, numbers or hyphens. Start and end with a letter or number.
            </p>
            {error && (
              <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {pending ? "Saving…" : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
