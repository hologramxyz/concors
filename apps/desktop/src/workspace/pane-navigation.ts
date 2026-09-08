export type Direction = "left" | "right" | "up" | "down";
export interface PaneBounds {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** Prefer a pane sharing the facing edge; break ties by center distance. Never wrap. */
export function neighborPane(
  panes: PaneBounds[],
  current: string,
  direction: Direction,
): string | null {
  const source = panes.find((pane) => pane.id === current);
  if (!source) return null;
  const horizontal = direction === "left" || direction === "right";
  const forward = direction === "right" || direction === "down";
  const along = (p: PaneBounds) => (horizontal ? (p.left + p.right) / 2 : (p.top + p.bottom) / 2);
  const across = (p: PaneBounds) => (horizontal ? (p.top + p.bottom) / 2 : (p.left + p.right) / 2);
  const overlap = (p: PaneBounds) =>
    horizontal
      ? Math.min(source.bottom, p.bottom) > Math.max(source.top, p.top)
      : Math.min(source.right, p.right) > Math.max(source.left, p.left);
  return (
    panes
      .filter(
        (p) => p.id !== current && (forward ? along(p) > along(source) : along(p) < along(source)),
      )
      .sort(
        (a, b) =>
          Number(overlap(b)) - Number(overlap(a)) ||
          Math.hypot(along(a) - along(source), across(a) - across(source)) -
            Math.hypot(along(b) - along(source), across(b) - across(source)),
      )[0]?.id ?? null
  );
}
