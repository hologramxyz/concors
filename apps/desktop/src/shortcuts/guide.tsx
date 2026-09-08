import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BINDINGS, isMac, shortcutLabel } from "./bindings";
export function ShortcutGuide({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            {isMac() && "On Mac, use the physical Control (⌃) key, not Command (⌘). "}
            Press a P or T shortcut, release the keys, then choose the next key. Escape cancels.
            Ctrl+Shift+Arrow moves between panes, including from the Agent input. Other form fields
            keep their normal text-selection keys.
          </DialogDescription>
        </DialogHeader>
        <dl className="max-h-[55vh] space-y-3 overflow-y-auto text-[15px]">
          {BINDINGS.map((binding) => (
            <div
              key={binding.id}
              className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-4"
            >
              <dt>{binding.label}</dt>
              <dd>
                <kbd className="rounded border bg-muted px-2 py-1 font-mono text-sm">
                  {shortcutLabel(binding.id)}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Outside terminals, ⌘K / Ctrl+K also opens search. Use Alt+Shift+Left/Right on a tab to
          reorder it, or arrow keys on a split divider to resize panes.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          P → Enter creates a pane to the right; P → an arrow chooses its position. T → Enter opens
          the tab profile picker; T → Left/Right cycles tabs. Backspace after P/T closes the
          pane/tab, leaving its sessions running. Ctrl+Shift+K searches projects and commands. The
          desktop app also supports Ctrl+Tab / Ctrl+Shift+Tab; browsers keep those for browser tabs.
        </p>
      </DialogContent>
    </Dialog>
  );
}
