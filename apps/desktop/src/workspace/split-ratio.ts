/** Splits keep each side at least this share of their width or height. */
export const clampRatio = (value: number) => Math.min(0.9, Math.max(0.1, value));

/**
 * The split ratio that keeps the handle under the pointer. The two sides share the split's size
 * minus the handle's own, and `grab` is how far from the handle's centre the drag started, so the
 * handle neither jumps to the pointer on press nor drifts from it as it moves.
 */
export function splitRatio({
  pointer,
  start,
  size,
  handle,
  grab,
}: {
  /** The pointer's position along the split's axis. */
  pointer: number;
  /** Where the split begins along that axis. */
  start: number;
  size: number;
  handle: number;
  grab: number;
}): number {
  const available = size - handle;
  if (available <= 0) return 0.5;
  return clampRatio((pointer - grab - start - handle / 2) / available);
}
