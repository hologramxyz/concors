import { useState, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { isTauri } from "@/tauri";
import { Context, createCommands } from "./context";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  isMac,
  keyLabel,
  matchShortcut,
  matchSequence,
  sequenceBindings,
  type Sequence,
  type CommandId,
} from "./bindings";
export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [commands] = useState(createCommands);
  const available = useSyncExternalStore(commands.subscribe, commands.snapshot);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const armed = useRef<Sequence | null>(null);
  const [lastSequence, setLastSequence] = useState<Sequence>("p");
  const returnFocus = useRef<HTMLElement | null>(null);
  const action = useRef<CommandId | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const cancel = () => {
    armed.current = null;
    setSequence(null);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.getModifierState("AltGraph")) {
        cancel();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const terminal = !!target?.closest(".xterm");
      const editing =
        !!target?.closest('input, textarea, select, [contenteditable="true"]') && !terminal;
      const composer = !!target?.closest("[data-agent-composer]");
      const modal = !!document.querySelector(
        '[role="dialog"]:not([data-shortcut-dialog]), [role="alertdialog"], [role="menu"]',
      );
      const consume = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      if (armed.current) {
        if (
          event.repeat &&
          event.ctrlKey &&
          event.shiftKey &&
          event.key.toLowerCase() === armed.current
        ) {
          consume();
          return;
        }
        if (modal || (editing && !composer)) {
          cancel();
          return;
        }
        if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
        // Tab can reach every action and the close button. Enter/Space activate that button.
        if (
          event.key === "Tab" ||
          (target?.closest("button") && ["Enter", " "].includes(event.key))
        )
          return;
        if (event.key === "Escape") {
          consume();
          cancel();
          return;
        }
        const id =
          !event.altKey && !event.metaKey ? matchSequence(armed.current, event.key) : undefined;
        if (id) {
          consume();
          if (!event.repeat) {
            action.current = id;
            cancel();
          }
          return;
        }
        cancel();
      }
      if (commands.snapshot().length === 0) return;
      const id = matchShortcut(event, isMac(), terminal, isTauri());
      if (!id) return;
      // Agent inputs participate in workspace navigation; ordinary form fields retain editing keys.
      if (editing && id !== "search" && !composer) {
        if (!id.startsWith("focus-")) event.preventDefault();
        return;
      }
      if (modal && !(id === "search" && target?.closest("[cmdk-root]"))) {
        if (!id.startsWith("focus-")) event.preventDefault();
        return;
      }
      consume();
      if (event.repeat && !id.startsWith("focus-")) return;
      if (id === "p" || id === "t") {
        if (!sequenceBindings(id).some((binding) => commands.snapshot().includes(binding.id)))
          return;
        armed.current = id;
        action.current = null;
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setLastSequence(id);
        setSequence(id);
      } else commands.run(id);
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("blur", cancel);
    };
  }, [commands]);
  return (
    <Context value={commands}>
      {children}
      <Dialog open={sequence !== null} onOpenChange={(open) => !open && cancel()}>
        <DialogContent
          ref={dialog}
          data-shortcut-dialog
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dialog.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const next = action.current;
            action.current = null;
            // Wait for the focus trap to release before opening a menu or focusing another pane.
            requestAnimationFrame(() => {
              if (document.querySelector('[role="dialog"][data-state="open"]')) return;
              if (next && commands.snapshot().includes(next)) commands.run(next);
              else if (returnFocus.current?.isConnected) returnFocus.current.focus();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{lastSequence === "p" ? "Pane shortcuts" : "Tab shortcuts"}</DialogTitle>
            <DialogDescription>
              Release the shortcut keys, then choose an action. Esc cancels.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {sequenceBindings(lastSequence).map((binding) => (
              <Button
                key={binding.id}
                type="button"
                variant="ghost"
                disabled={!available.includes(binding.id)}
                onClick={() => {
                  action.current = binding.id;
                  cancel();
                }}
                className="h-auto min-h-11 w-full justify-between gap-3 px-3 py-2.5 text-left text-[15px] font-normal whitespace-normal"
              >
                <span>{binding.label}</span>
                <kbd className="min-w-9 shrink-0 rounded border bg-muted px-2 py-1 text-center font-mono text-sm">
                  {"then" in binding ? keyLabel(binding.then) : ""}
                </kbd>
              </Button>
            ))}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Context>
  );
}
