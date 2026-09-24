/**
 * The webview's own right-click menu (Back, Forward, Reload, Inspect Element) is a browser menu
 * that means nothing in an app window, so it is suppressed. Text fields and selected text keep
 * theirs, because that is where copy, paste and spelling suggestions live. Menus the app draws
 * itself (Radix context menus) open from their own handlers and are unaffected.
 */
export function keepsNativeContextMenu(target: EventTarget | null, selectedText: string) {
  if (selectedText.trim()) return true;
  const element =
    target && "closest" in target && typeof target.closest === "function"
      ? (target as Element)
      : null;
  return !!element?.closest("input, textarea, [contenteditable]:not([contenteditable='false'])");
}

export function suppressNativeContextMenu() {
  document.addEventListener("contextmenu", (event) => {
    if (!keepsNativeContextMenu(event.target, window.getSelection()?.toString() ?? ""))
      event.preventDefault();
  });
}
