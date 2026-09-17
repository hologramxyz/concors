export interface SurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type SurfaceLayer = "sidebar" | "workspace" | "files";

/** Panel order is sidebar < workspace < files, independent of registration order.
 * Preserve the full control frame: clipping must not resize its label or glass shape.
 */
export function clipNativeSurface(
  rect: SurfaceRect,
  layer: SurfaceLayer,
  viewport: { width: number; height: number },
  workspace: SurfaceRect,
  files: SurfaceRect,
): SurfaceRect | null {
  const panel = layer === "files" ? files : layer === "workspace" ? workspace : null;
  const left = Math.max(0, rect.x, panel?.x ?? 0);
  const top = Math.max(0, rect.y, panel?.y ?? 0);
  const right = Math.min(
    viewport.width,
    rect.x + rect.width,
    panel ? panel.x + panel.width : viewport.width,
    layer === "sidebar" ? workspace.x : Infinity,
    layer !== "files" ? files.x : Infinity,
  );
  const bottom = Math.min(
    viewport.height,
    rect.y + rect.height,
    panel ? panel.y + panel.height : viewport.height,
  );
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}
