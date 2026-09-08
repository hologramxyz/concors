import { useState, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { isTauri } from "@/tauri";
import { Context, createCommands } from "./context";
import {
  isMac,
  keyLabel,
  matchShortcut,
  matchSequence,
  sequenceBindings,
  type Sequence,
} from "./bindings";
export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [commands] = useState(createCommands);
  const available = useSyncExternalStore(commands.subscribe, commands.snapshot);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const armed = useRef<Sequence | null>(null);
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
      const modal = !!document.querySelector(
        '[role="dialog"], [role="alertdialog"], [role="menu"]',
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
        if (modal || editing) {
          cancel();
          return;
        }
        if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
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
            cancel();
            commands.run(id);
          }
          return;
        }
        cancel();
      }
      if (commands.snapshot().length === 0) return;
      const id = matchShortcut(event, isMac(), terminal, isTauri());
      if (!id) return;
      // Preserve selection shortcuts in chat/editors rather than preventing their defaults.
      if (editing && id !== "search") {
        if (!id.startsWith("focus-")) event.preventDefault();
        return;
      }
      if (modal && !(id === "search" && target?.closest("[cmdk-root]"))) {
        if (!id.startsWith("focus-")) event.preventDefault();
        return;
      }
      consume();
      if (event.repeat) return;
      if (id === "p" || id === "t") {
        if (!sequenceBindings(id).some((binding) => commands.snapshot().includes(binding.id)))
          return;
        armed.current = id;
        setSequence(id);
      } else commands.run(id);
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("pointerdown", cancel, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pointerdown", cancel, true);
    };
  }, [commands]);
  return (
    <Context value={commands}>
      {children}
      {sequence && (
        <div
          role="region"
          aria-label={sequence === "p" ? "Pane shortcuts" : "Tab shortcuts"}
          className="fixed bottom-6 left-1/2 z-[100] w-80 -translate-x-1/2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <p className="mb-2 text-sm font-medium">
            {sequence === "p" ? "Pane" : "Tab"} · choose an action
          </p>
          {sequenceBindings(sequence).map((binding) => (
            <button
              key={binding.id}
              type="button"
              disabled={!available.includes(binding.id)}
              onClick={() => {
                cancel();
                commands.run(binding.id);
              }}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-[13px] hover:bg-accent disabled:opacity-40"
            >
              {binding.label}
              <kbd className="ml-3 font-mono">
                {"then" in binding ? keyLabel(binding.then) : ""}
              </kbd>
            </button>
          ))}
          <p className="mt-2 text-xs text-muted-foreground">
            Release the shortcut keys, then choose. Esc cancels.
          </p>
        </div>
      )}
    </Context>
  );
}
