import { createContext, useEffect, useId, useState } from "react";

// Portaled controls remain part of the same composer focus boundary.
export const ComposerSurfaceContext = createContext<string | undefined>(undefined);

export function useComposerExpansion(compact: boolean) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!compact) return;
    const owns = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest("[data-composer-surface]")?.getAttribute("data-composer-surface") === id;
    const collapse = () => {
      setExpanded(false);
      const focused = document.activeElement;
      if (owns(focused) && focused instanceof HTMLTextAreaElement) focused.blur();
    };
    let pointerActive = false;
    const pointerDown = () => {
      pointerActive = true;
    };
    const pointerEnd = () => {
      pointerActive = false;
    };
    // Collapse after the click is delivered. Shrinking on pointerdown/focusin
    // moves timeline actions between press and release and can swallow their click.
    const click = (event: MouseEvent) => {
      if (!owns(event.target)) collapse();
    };
    const focus = (event: FocusEvent) => {
      if (owns(event.target)) setExpanded(true);
      else if (!pointerActive && event.target !== document.body) collapse();
    };
    const viewport = window.visualViewport;
    let width = window.innerWidth;
    let largest = viewport?.height ?? window.innerHeight;
    let smallest = largest;
    const resize = () => {
      const height = viewport?.height ?? window.innerHeight;
      if (Math.abs(window.innerWidth - width) > 40) {
        width = window.innerWidth;
        largest = smallest = height;
        return;
      }
      largest = Math.max(largest, height);
      if (largest - smallest > 100 && height - smallest > 100) {
        // The native host or browser resized back after keyboard dismissal.
        // A picker may take focus from the keyboard. Keep its controls mounted,
        // but collapse after ordinary toolbar actions (whose buttons can retain focus).
        const pickerOpen = [...document.querySelectorAll("[data-composer-surface]")].some(
          (element) =>
            element.tagName !== "FORM" && element.getAttribute("data-composer-surface") === id,
        );
        if (!pickerOpen) collapse();
        largest = smallest = height;
      } else smallest = Math.min(smallest, height);
    };
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("pointerup", pointerEnd, true);
    document.addEventListener("pointercancel", pointerEnd, true);
    document.addEventListener("click", click);
    document.addEventListener("focusin", focus);
    window.addEventListener("resize", resize);
    viewport?.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("pointerup", pointerEnd, true);
      document.removeEventListener("pointercancel", pointerEnd, true);
      document.removeEventListener("click", click);
      document.removeEventListener("focusin", focus);
      window.removeEventListener("resize", resize);
      viewport?.removeEventListener("resize", resize);
    };
  }, [compact, id]);
  return {
    owner: compact ? id : undefined,
    expanded: !compact || expanded,
    expand: () => setExpanded(true),
  };
}
