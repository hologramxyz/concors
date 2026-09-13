import { useContext, useId, useState } from "react";
import { Popover } from "radix-ui";
import { MachineIconSchema, type Machine } from "@concors/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MachineIcon } from "./machine-icon";
import { CompactLayoutContext } from "@/components/compact-layout";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const EMOJI = [
  ["🚀", "Rocket"],
  ["🧪", "Testing"],
  ["💻", "Laptop"],
  ["🌍", "Globe"],
  ["⚡", "Lightning"],
  ["🤖", "Robot"],
  ["🛠️", "Tools"],
  ["☁️", "Cloud"],
  ["📦", "Package"],
  ["🗄️", "Database"],
  ["🧠", "Brain"],
  ["🎯", "Target"],
  ["🔥", "Fire"],
  ["🌱", "Seedling"],
  ["🎮", "Games"],
  ["🎨", "Design"],
  ["🦊", "Fox"],
  ["🐳", "Whale"],
  ["🐙", "Octopus"],
  ["🐧", "Penguin"],
  ["💎", "Gem"],
  ["⭐", "Star"],
  ["🌙", "Moon"],
  ["☀️", "Sun"],
] as const;

export function MachineIconPicker({
  machine,
  onSave,
}: {
  machine: Machine;
  onSave: (icon: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const compact = useContext(CompactLayoutContext);
  const onOpenChange = (next: boolean) => {
    if (!busy) setOpen(next);
  };
  const trigger = (
    <button
      type="button"
      aria-label={`Change icon for ${machine.name}`}
      title="Change icon"
      className="-ml-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <MachineIcon icon={machine.icon} className="size-5 text-xl" />
    </button>
  );
  const editor = open && (
    <IconEditor
      icon={machine.icon ?? null}
      busy={busy}
      showTitle={!compact}
      onSave={async (icon) => {
        setBusy(true);
        try {
          await onSave(icon);
          setOpen(false);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  if (compact)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent aria-describedby={undefined} showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Machine icon</DialogTitle>
          </DialogHeader>
          {editor}
        </DialogContent>
      </Dialog>
    );
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Customize machine icon"
          className="z-50 w-[320px] max-w-[calc(100vw-24px)] rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl outline-none"
        >
          {editor}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function IconEditor({
  icon,
  busy,
  onSave,
  showTitle,
}: {
  icon: string | null;
  busy: boolean;
  showTitle: boolean;
  onSave: (icon: string | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(icon);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const valid = MachineIconSchema.safeParse(draft).success;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        setError(null);
        void onSave(draft).catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "Could not save icon"),
        );
      }}
      className="space-y-4"
    >
      {showTitle && <p className="text-sm font-medium">Machine icon</p>}
      <div className="grid grid-cols-6 gap-1" role="group" aria-label="Suggested icons">
        {EMOJI.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={draft === value}
            disabled={busy}
            onClick={() => {
              setDraft(value);
              setError(null);
            }}
            className="flex size-10 items-center justify-center rounded-lg text-xl hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-primary/15 aria-pressed:ring-1 aria-pressed:ring-primary"
          >
            <span aria-hidden="true">{value}</span>
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          Or paste any emoji
        </label>
        <Input
          id={inputId}
          aria-label="Custom emoji"
          value={draft ?? ""}
          maxLength={32}
          disabled={busy}
          placeholder="🚀"
          onChange={(event) => {
            setDraft(event.target.value || null);
            setError(null);
          }}
          aria-invalid={!valid}
        />
        {!valid && <p className="text-xs text-destructive">Choose a single emoji.</p>}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setDraft(null);
            setError(null);
          }}
        >
          Reset to default
        </Button>
        <Button type="submit" size="sm" disabled={!valid || busy}>
          {busy ? "Saving…" : "Save icon"}
        </Button>
      </div>
    </form>
  );
}
