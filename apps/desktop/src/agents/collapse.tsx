import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * A panel that eases open and shut like the sidebar's lists (`.sidebar-collapse`: grid rows
 * 0fr ↔ 1fr and opacity, 200ms), so what sits below it glides instead of jumping. Reduced motion
 * makes it instant. Its content mounts on first opening, so a closed row costs nothing, and stays
 * mounted (hidden from focus and screen readers) while closed.
 */
export function Collapse({
  open,
  className = "",
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (!open) {
      element.dataset.collapsed = "";
      return;
    }
    // It mounts shut, so a first opening eases too: commit the shut state, then open.
    void element.offsetHeight;
    delete element.dataset.collapsed;
  }, [open, seen]);
  if (!seen) return null;
  return (
    // The attribute is only the starting state: the effect owns it from then on, and React leaves
    // a prop that never changes alone.
    <div ref={panel} className={`sidebar-collapse ${className}`} data-collapsed="">
      <div>{children}</div>
    </div>
  );
}
