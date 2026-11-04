import { useEffect, type RefObject } from "react";

/**
 * Keeps the composer's clipped controls out of the Tab order. A narrow toolbar wraps its lowest
 * priority controls below a clipped box, which CSS alone cannot tell apart from the ones on show,
 * so this looks at where each one ended up, whenever the toolbar resizes or its controls change.
 */
export function useClippedControls(toolbar: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const row = toolbar.current;
    if (!enabled || !row) return;
    const update = () => {
      for (const group of row.querySelectorAll(
        ".agent-composer-controls, .mobile-composer-primary",
      )) {
        const box = group.getBoundingClientRect();
        for (const button of group.querySelectorAll("button")) {
          const area = button.getBoundingClientRect();
          button.inert = area.width > 0 && (area.top >= box.bottom || area.right <= box.left);
        }
      }
    };
    const resized = new ResizeObserver(update);
    resized.observe(row);
    const changed = new MutationObserver(update);
    changed.observe(row, { childList: true, subtree: true });
    update();
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [toolbar, enabled]);
}
