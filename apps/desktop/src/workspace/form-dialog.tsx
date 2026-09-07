import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface FormField {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
}
export function FormDialog({
  title,
  description,
  fields,
  submitLabel = "Save",
  onSubmit,
  onClose,
}: {
  title: string;
  description: ReactNode;
  fields: FormField[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(
              new FormData(event.currentTarget).entries(),
            ) as Record<string, string>;
            setPending(true);
            setError(null);
            void Promise.resolve()
              .then(() => onSubmit(values))
              .then(onClose)
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "Could not save");
              })
              .finally(() => setPending(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="my-5 space-y-4">
            {fields.map((field) => (
              <label key={field.name} className="block space-y-2 text-sm">
                <span>{field.label}</span>
                <Input
                  name={field.name}
                  defaultValue={field.value ?? ""}
                  placeholder={field.placeholder}
                  required
                  maxLength={field.name === "directory" || field.name === "url" ? 4096 : 120}
                  disabled={pending}
                />
              </label>
            ))}
          </div>
          {error && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
