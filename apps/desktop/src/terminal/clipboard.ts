import type { Terminal } from "@xterm/xterm";

export function clipboardAction(event: KeyboardEvent): "copy" | "paste" | undefined {
  if (event.isComposing || event.altKey || event.getModifierState("AltGraph")) return;
  const superKey = event.metaKey && !event.ctrlKey;
  const controlShift = event.ctrlKey && event.shiftKey && !event.metaKey;
  if (!superKey && !controlShift) return;
  switch (event.key.toLowerCase()) {
    case "c":
      return "copy";
    case "v":
      return "paste";
  }
}

/** Consume clipboard chords before xterm turns them into terminal input. */
export function terminalClipboardHandler({
  terminal,
  read,
  write,
  canPaste,
  report,
}: {
  terminal: Pick<Terminal, "getSelection" | "paste">;
  read: () => Promise<string>;
  write: (text: string) => Promise<void>;
  canPaste: () => boolean;
  report: (error: Error) => void;
}) {
  let pasting = false;
  return (event: KeyboardEvent): boolean => {
    const action = clipboardAction(event);
    if (!action) return true;
    event.preventDefault();
    event.stopPropagation();
    // xterm also calls this for keypress and keyup. Holding a shortcut must not paste repeatedly.
    if (event.type !== "keydown" || event.repeat) return false;
    void (async () => {
      try {
        if (action === "copy") {
          const selection = terminal.getSelection();
          // An empty selection must neither clear the clipboard nor send Ctrl+C.
          if (selection) await write(selection);
        } else if (!pasting && canPaste()) {
          pasting = true;
          try {
            const text = await read();
            // The user may have switched panes, disconnected, or closed this terminal meanwhile.
            if (canPaste()) terminal.paste(text);
          } finally {
            pasting = false;
          }
        }
      } catch {
        report(
          new Error(
            `Could not ${action === "copy" ? "copy to" : "paste from"} the clipboard. Check clipboard access and try again.`,
          ),
        );
      }
    })();
    return false;
  };
}
