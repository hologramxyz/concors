/**
 * Someone typing into a field outside every pane, such as a tab's name, keeps the focus: a pane
 * that becomes ready a moment later (a composer turning usable, a terminal taking control) must not
 * take it mid-word. Focus in another pane is each caller's own call, since a split starts out
 * focused in the pane it came from.
 */
export function typingOutsidePanes(focused: Element | null): boolean {
  return (
    !!focused &&
    !focused.closest("[data-pane-id]") &&
    focused.matches("input, textarea, select, [contenteditable='true'], [role='textbox']")
  );
}
