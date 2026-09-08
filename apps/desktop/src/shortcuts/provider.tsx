import { useState, useEffect, type ReactNode } from "react";
import { Context, createCommands } from "./context";
import { isMac, matchShortcut } from "./bindings";
export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [commands] = useState(createCommands);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (commands.snapshot().length === 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const id = matchShortcut(event, isMac(), !!target?.closest(".xterm"));
      if (!id || event.defaultPrevented || event.getModifierState("AltGraph")) return;
      // Let dialogs, profile menus and text forms own their keyboard interaction.
      if (
        document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') &&
        !(id === "search" && target?.closest("[cmdk-root]"))
      )
        return;
      if (
        id !== "search" &&
        target?.closest('input, textarea, select, [contenteditable="true"]') &&
        !target.closest(".xterm")
      )
        return;
      // Reserve recognized app chords even when disconnected or at a layout limit.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) commands.run(id);
    };
    // Capture before xterm so app shortcuts never reach the running process.
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [commands]);
  return <Context value={commands}>{children}</Context>;
}
