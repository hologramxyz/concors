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
import { type CommandId } from "./bindings";
import {
  bindingLabel,
  eventStroke,
  isTextNavigation,
  matchContinuation,
  matchKeymap,
  strokeId,
  strokeLabel,
  type KeymapEntry,
} from "./keymap";
import { ShortcutPreferencesProvider } from "./preferences";
import { useShortcutPreferences, type ExternalShortcutPreferences } from "./preferences-context";
export function ShortcutProvider({
  children,
  preferences,
}: {
  children: ReactNode;
  preferences?: ExternalShortcutPreferences;
}) {
  return (
    <ShortcutPreferencesProvider {...(preferences ? { external: preferences } : {})}>
      <ShortcutHandler>{children}</ShortcutHandler>
    </ShortcutPreferencesProvider>
  );
}
function ShortcutHandler({ children }: { children: ReactNode }) {
  const { keymap, mac } = useShortcutPreferences();
  const [commands] = useState(createCommands);
  const available = useSyncExternalStore(commands.subscribe, commands.snapshot);
  const [sequenceKeymap, setSequenceKeymap] = useState(keymap);
  const [sequence, setSequence] = useState<readonly KeymapEntry[] | null>(null);
  const armed = useRef<readonly KeymapEntry[] | null>(null);
  const [lastSequence, setLastSequence] = useState<readonly KeymapEntry[]>([]);
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
      if (target?.closest("[data-shortcut-recorder]")) {
        cancel();
        return;
      }
      const terminal = !!target?.closest(".xterm");
      const editing =
        !!target?.closest('input, textarea, select, [contenteditable="true"]') && !terminal;
      const composer = !!target?.closest("[data-agent-composer]");
      // A dialog playing its exit animation (mobile drawers slide out for 200ms) is already
      // closed; counting it would swallow a shortcut pressed right after dismissing it.
      const modal = !!document.querySelector(
        ':is([role="dialog"]:not([data-shortcut-dialog]), [role="alertdialog"], [role="menu"]):not([data-state="closed"])',
      );
      const consume = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      if (armed.current) {
        const stroke = eventStroke(event);
        const prefix = armed.current[0]?.binding.keys[0];
        if (event.repeat && stroke && prefix && strokeId(stroke) === strokeId(prefix)) {
          consume();
          return;
        }
        if (modal || (editing && !composer)) {
          cancel();
          return;
        }
        if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
        const id = matchContinuation(event, armed.current)?.id;
        // Unassigned Tab reaches every action. Enter/Space activate the focused button.
        if (
          (event.key === "Tab" && !id) ||
          (target?.closest("button") && ["Enter", " "].includes(event.key))
        )
          return;
        if (event.key === "Escape") {
          consume();
          cancel();
          return;
        }
        if (id) {
          consume();
          if (!event.repeat) {
            action.current = id;
            cancel();
          }
          return;
        }
        consume();
        cancel();
        return;
      }
      if (commands.snapshot().length === 0) return;
      const matches = matchKeymap(
        event,
        keymap,
        terminal,
        isTauri(),
        !!target?.closest("[data-shortcut-tab-id]"),
      );
      const first = matches[0];
      if (!first) return;
      const id = first.id;
      // Agent inputs participate in workspace commands but keep native word selection;
      // ordinary form fields retain editing keys.
      if (
        editing &&
        id !== "search" &&
        (!composer || (id.startsWith("focus-") && isTextNavigation(event, mac)))
      ) {
        if (!id.startsWith("focus-")) event.preventDefault();
        return;
      }
      if (modal && !(id === "search" && target?.closest("[cmdk-root]"))) {
        if (!id.startsWith("focus-")) event.preventDefault();
        return;
      }
      consume();
      if (event.repeat && !id.startsWith("focus-")) return;
      if (first.binding.keys.length === 2) {
        if (!matches.some((binding) => commands.snapshot().includes(binding.id))) return;
        armed.current = matches;
        action.current = null;
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setSequenceKeymap(keymap);
        setLastSequence(matches);
        setSequence(matches);
      } else commands.run(id);
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("blur", cancel);
    };
  }, [commands, keymap, mac]);
  useEffect(() => {
    armed.current = null;
    action.current = null;
  }, [keymap]);
  return (
    <Context value={commands}>
      {children}
      <Dialog
        open={sequence !== null && sequenceKeymap === keymap}
        onOpenChange={(open) => !open && cancel()}
      >
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
              if (next && commands.snapshot().includes(next)) {
                // Tab-scoped sequences must act on the original focused tab, which can
                // differ from the selected tab while keyboard-navigating the tab strip.
                if (
                  returnFocus.current?.isConnected &&
                  returnFocus.current.closest("[data-shortcut-tab-id]")
                )
                  returnFocus.current.focus({ preventScroll: true });
                commands.run(next);
              } else if (returnFocus.current?.isConnected) returnFocus.current.focus();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Shortcut actions</DialogTitle>
            <DialogDescription>
              {lastSequence[0] &&
                bindingLabel(
                  { ...lastSequence[0].binding, keys: lastSequence[0].binding.keys.slice(0, 1) },
                  mac,
                )}
              : release the keys, then choose an action. Esc cancels.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {lastSequence.map((binding) => (
              <Button
                key={`${binding.id}:${binding.index}`}
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
                  {binding.binding.keys[1] ? strokeLabel(binding.binding.keys[1], mac) : ""}
                </kbd>
              </Button>
            ))}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Context>
  );
}
