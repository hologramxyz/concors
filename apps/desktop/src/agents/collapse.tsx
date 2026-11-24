import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The sidebar lists' motion (`.sidebar-collapse` in styles.css). */
const DURATION = 200;
const EASE = cubicBezier(0.2, 0, 0, 1);
const FADE = `opacity ${DURATION}ms cubic-bezier(0.2, 0, 0, 1)`;

/**
 * A panel that opens and shuts with the sidebar lists' motion (200ms, cubic-bezier(0.2, 0, 0, 1);
 * hidden from focus and screen readers once shut). Reduced motion makes it instant.
 *
 * Its rows slide in whole. The content sits on the panel's moving lower edge, so each row comes
 * down with its icon and words together; a row the edge still cuts stays hidden, and fades in once
 * all of it is inside. Every frame moves the content by whole device pixels, so its icons and
 * words, which WebKit rounds to pixels separately, sit exactly as they do at rest. The panel's
 * own height is what moves, so what sits below follows the visible edge exactly.
 *
 * The rows are the children of an element marked `data-collapse-rows`; without one, the content
 * is one row. It mounts on first opening, so a shut panel costs nothing.
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
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    const inner = content.current;
    if (!element || !inner) return;
    const rows = panelRows(element, inner);
    const from = element.getBoundingClientRect().height;
    // While it moves, the content keeps its full height: it slides rather than squeezes.
    inner.style.flexShrink = "0";
    const full = inner.getBoundingClientRect().height;
    const to = open ? full : 0;
    if (open) delete element.dataset.collapsed;
    const finish = () => {
      // Open, it follows its content again (a row opening inside it, a stream growing).
      element.style.height = open ? "" : "0px";
      if (!open) element.dataset.collapsed = "";
      inner.style.flexShrink = "";
      for (const row of rows) {
        row.style.opacity = "";
        row.style.transition = "";
      }
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(to - from) < 0.5) {
      finish();
      return;
    }
    const pixel = 1 / devicePixelRatio;
    const place = (height: number) => {
      // How far the content sits above its resting place, in whole device pixels.
      const lift = Math.round((full - height) / pixel) * pixel;
      element.style.height = `${Math.max(0, full - lift)}px`;
      const edge = element.getBoundingClientRect();
      for (const row of rows) {
        const box = row.getBoundingClientRect();
        const whole = box.top >= edge.top - 0.5 && box.bottom <= edge.bottom + 0.5;
        // A row the edge cuts goes at once; a whole one fades in.
        row.style.transition = whole ? FADE : "none";
        row.style.opacity = whole ? "" : "0";
      }
    };
    place(from);
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / DURATION);
      place(from + (to - from) * EASE(progress));
      if (progress < 1) frame = requestAnimationFrame(step);
      else finish();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, seen]);
  if (!seen) return null;
  return (
    // The attribute and height are only the starting state: the effect owns them from then on,
    // and React leaves props that never change alone.
    <div
      ref={panel}
      data-collapsed=""
      data-collapse-panel=""
      style={{ height: 0 }}
      className={`flex flex-col justify-end overflow-hidden data-[collapsed]:invisible ${className}`}
    >
      <div ref={content} className="flex min-h-0 flex-col">
        {children}
      </div>
    </div>
  );
}

/** This panel's rows, not those of a panel inside one of them. */
function panelRows(element: HTMLElement, inner: HTMLElement): HTMLElement[] {
  const list = [...element.querySelectorAll<HTMLElement>("[data-collapse-rows]")].find(
    (rows) => rows.closest("[data-collapse-panel]") === element,
  );
  return list
    ? [...list.children].filter((row): row is HTMLElement => row instanceof HTMLElement)
    : [inner];
}

/** CSS's cubic-bezier() timing function: progress through time → progress of the motion. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const curve = (a: number, b: number, t: number) =>
    3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  return (x: number) => {
    if (x <= 0 || x >= 1) return x <= 0 ? 0 : 1;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 24; i++) {
      const t = (low + high) / 2;
      if (curve(x1, x2, t) < x) low = t;
      else high = t;
    }
    return curve(y1, y2, (low + high) / 2);
  };
}
