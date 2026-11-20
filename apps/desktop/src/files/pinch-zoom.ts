/**
 * The arithmetic behind a full-screen image a finger can zoom and pan. A view is the image's
 * scale over its fit and its offset in pixels from the centre of the space it is shown in, the
 * same order CSS applies `translate(x, y) scale(scale)` about the image's centre.
 */
export interface ZoomView {
  scale: number;
  x: number;
  y: number;
}
/** The space the image is shown in, and the image's size at a scale of 1. */
export interface ZoomBounds {
  width: number;
  height: number;
  fitWidth: number;
  fitHeight: number;
}
export interface Point {
  x: number;
  y: number;
}

export const FIT: ZoomView = { scale: 1, x: 0, y: 0 };
export const MAX_SCALE = 6;
/** How far a double tap zooms in, from the fit. */
export const DOUBLE_TAP_SCALE = 2.5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Never smaller than the fit, and never so far off-centre that the image leaves an edge bare. */
export function clampView(view: ZoomView, bounds: ZoomBounds): ZoomView {
  const scale = clamp(view.scale, 1, MAX_SCALE);
  const spareX = Math.max(0, (bounds.fitWidth * scale - bounds.width) / 2);
  const spareY = Math.max(0, (bounds.fitHeight * scale - bounds.height) / 2);
  return { scale, x: clamp(view.x, -spareX, spareX) || 0, y: clamp(view.y, -spareY, spareY) || 0 };
}

/** Zooms to `scale`, keeping the image under `focus` (from the centre) where it is. */
export function zoomAt(view: ZoomView, scale: number, focus: Point, bounds: ZoomBounds): ZoomView {
  const next = clamp(scale, 1, MAX_SCALE);
  const ratio = next / view.scale;
  return clampView(
    {
      scale: next,
      x: focus.x - (focus.x - view.x) * ratio,
      y: focus.y - (focus.y - view.y) * ratio,
    },
    bounds,
  );
}

/**
 * Two fingers: the image scales with the distance between them and follows their midpoint, so
 * the point first under the fingers stays under them.
 */
export function pinch(
  start: ZoomView,
  from: { mid: Point; distance: number },
  to: { mid: Point; distance: number },
  bounds: ZoomBounds,
): ZoomView {
  const scaled = zoomAt(
    start,
    (start.scale * to.distance) / Math.max(1, from.distance),
    from.mid,
    // Unclamped here: clamping before the move would pin a pinch that starts near an edge.
    { width: 0, height: 0, fitWidth: Infinity, fitHeight: Infinity },
  );
  return clampView(
    { ...scaled, x: scaled.x + to.mid.x - from.mid.x, y: scaled.y + to.mid.y - from.mid.y },
    bounds,
  );
}

/** A double tap zooms in on the point tapped, or back out to the fit when already zoomed. */
export function doubleTap(view: ZoomView, at: Point, bounds: ZoomBounds): ZoomView {
  return view.scale > 1.01 ? FIT : zoomAt(view, DOUBLE_TAP_SCALE, at, bounds);
}
