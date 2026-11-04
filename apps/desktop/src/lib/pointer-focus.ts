/** Where a ring belongs however focus got there, as the person is about to type. */
const TEXT_ENTRY = "input:not([type=radio], [type=checkbox]), textarea, [contenteditable]";

/**
 * WebKit, so the Mac app, treats focus set by script as keyboard focus even right after a click:
 * closing a menu with the mouse left a ring on the menu's trigger. This marks focus that follows
 * the pointer, for `focus-visible` in styles.css to skip, until a key is pressed.
 */
export function markPointerFocus() {
  let pointer = false;
  window.addEventListener("pointerdown", () => (pointer = true), true);
  window.addEventListener(
    "keydown",
    (event) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      pointer = false;
      document.activeElement?.removeAttribute("data-pointer-focus");
    },
    true,
  );
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (pointer && target instanceof HTMLElement && !target.matches(TEXT_ENTRY))
      target.setAttribute("data-pointer-focus", "");
  });
  document.addEventListener("focusout", (event) => {
    if (event.target instanceof HTMLElement) event.target.removeAttribute("data-pointer-focus");
  });
}
