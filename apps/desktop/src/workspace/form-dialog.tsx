import { useRef, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface FormField {
  /** The field's accessible name; the sheet shows no label, only the value. */
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
}
/**
 * The phone's form sheet, laid out as its Workspaces sheet is: the fields, then one full-width
 * button. The close button and a swipe down cancel, so there is no Cancel. The first field opens
 * focused with its value selected, and Return saves, as the button does, once `canSubmit` allows.
 */
export function FormDialog({
  title,
  description,
  fields,
  submitLabel = "Save",
  canSubmit = () => true,
  onSubmit,
  onClose,
}: {
  title: string;
  description: ReactNode;
  fields: FormField[];
  submitLabel?: string;
  /** Whether these values would change anything; Save stays disabled until they do. */
  canSubmit?: (values: Record<string, string>) => boolean;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.value ?? ""])),
  );
  const first = useRef<HTMLInputElement>(null);
  const ready = canSubmit(values);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="mobile-select-sheet"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          first.current?.focus({ preventScroll: true });
          first.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || pending) return;
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
          {fields.map((field, index) => (
            <Input
              key={field.name}
              ref={index === 0 ? first : undefined}
              name={field.name}
              aria-label={field.label}
              value={values[field.name] ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setValues((current) => ({ ...current, [field.name]: value }));
              }}
              placeholder={field.placeholder}
              enterKeyHint="done"
              maxLength={field.name === "directory" || field.name === "url" ? 4096 : 120}
              disabled={pending}
            />
          ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button type="submit" className="mobile-new-tab-button" disabled={!ready || pending}>
            {pending ? "Saving…" : submitLabel}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
