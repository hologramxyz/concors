import type { Terminal } from "@xterm/xterm";

/**
 * `controlPaste` also treats plain Ctrl+V as paste. CLI agents bind it to "paste an image from the
 * clipboard", which on a remote machine reads that machine's (absent) clipboard; and Omarchy's
 * universal Super+V reaches the app as plain Ctrl+V. Shells keep Ctrl+V as a control character.
 */
export function clipboardAction(
  event: KeyboardEvent,
  controlPaste = false,
): "copy" | "paste" | undefined {
  if (event.isComposing || event.altKey || event.getModifierState("AltGraph")) return;
  if (
    controlPaste &&
    event.ctrlKey &&
    !event.shiftKey &&
    !event.metaKey &&
    event.key.toLowerCase() === "v"
  )
    return "paste";
  // Omarchy's universal clipboard bindings can arrive as these standard terminal chords.
  if (event.key === "Insert" && !event.metaKey) {
    if (event.ctrlKey && !event.shiftKey) return "copy";
    if (event.shiftKey && !event.ctrlKey) return "paste";
  }
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
  pasteImage,
  report,
}: {
  terminal: Pick<Terminal, "getSelection" | "paste">;
  read: () => Promise<string>;
  write: (text: string) => Promise<void>;
  canPaste: () => boolean;
  /**
   * Pastes the clipboard's image when it holds no text. Resolves false when there is no image or
   * this terminal cannot take one; set, it also makes plain Ctrl+V paste.
   */
  pasteImage?: { enabled: () => boolean; paste: () => Promise<boolean> };
  report: (error: Error) => void;
}) {
  let pasting = false;
  return (event: KeyboardEvent): boolean => {
    const action = clipboardAction(event, !!pasteImage?.enabled());
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
            let text = "",
              failure: unknown;
            try {
              text = await read();
            } catch (cause) {
              // An image-only clipboard has no text to read; that is not a failure yet.
              failure = cause;
            }
            if (!text && pasteImage?.enabled() && (await pasteImage.paste())) return;
            if (failure) throw failure;
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
