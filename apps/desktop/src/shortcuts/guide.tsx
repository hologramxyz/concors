import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BINDINGS, shortcutLabel } from "./bindings";
export function ShortcutGuide({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Workspace shortcuts work inside terminals. In forms and dialogs, finish or dismiss the
            dialog first.
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-[13px]">
          {BINDINGS.map((binding) => (
            <div key={binding.id} className="flex items-center justify-between gap-4">
              <dt>{binding.label}</dt>
              <dd>
                <kbd className="rounded border bg-muted px-2 py-1 font-mono text-xs">
                  {shortcutLabel(binding.id)}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Outside terminals, ⌘K / Ctrl+K also opens search. Use Alt+Shift+Left/Right on a tab to
          reorder it, or arrow keys on a split divider to resize panes.
        </p>
        <p className="text-xs text-muted-foreground">
          New tab opens the profile picker. New pane adds a pane beside the active pane, using its
          profile. Pane actions use the last focused pane. Closing a pane or tab leaves its sessions
          running.
        </p>
      </DialogContent>
    </Dialog>
  );
}
