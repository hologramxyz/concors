import { useState } from "react";
import { Keyboard, RotateCw, Square } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
export function MobileTerminalControls({
  disabled,
  onFocus,
  onKey,
  onReload,
  onStop,
}: {
  disabled: boolean;
  onFocus(): void;
  onKey(data: string): void;
  onReload(): void;
  onStop(): Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="mobile-terminal-controls" aria-label="Terminal controls">
        <button aria-label="Show keyboard" disabled={disabled} onClick={onFocus}>
          <Keyboard className="size-5" />
        </button>
        {[
          ["Esc", "\u001b"],
          ["Tab", "\t"],
          ["Ctrl C", "\u0003"],
          ["↑", "\u001b[A"],
          ["↓", "\u001b[B"],
          ["←", "\u001b[D"],
          ["→", "\u001b[C"],
        ].map(([label, value]) => (
          <button key={label} disabled={disabled} onClick={() => onKey(value ?? "")}>
            {label}
          </button>
        ))}
        <button aria-label="Reload terminal renderer" onClick={onReload}>
          <RotateCw className="size-4" />
        </button>
        <button
          aria-label="Stop terminal process"
          disabled={disabled}
          onClick={() => setConfirm(true)}
        >
          <Square className="size-4" />
        </button>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={(next) => {
          if (!busy) setConfirm(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop terminal process?</DialogTitle>
            <DialogDescription>
              This stops the process on the machine, not just this viewer. Leaving the pane or
              reloading the renderer does not stop it.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              Keep running
            </Button>
            <Button
              variant="destructive"
              disabled={busy || disabled}
              onClick={() => {
                setBusy(true);
                setError(null);
                void onStop()
                  .then(
                    () => setConfirm(false),
                    (cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : "Could not stop process"),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Stop process
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
