/** Files a tab shows read-only instead of in the editor. The machine checks the actual bytes. */
export type PreviewKind = "pdf" | "image" | "video";
export function previewKind(path: string): PreviewKind | null {
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.(png|jpe?g|gif|webp)$/i.test(path)) return "image";
  if (videoMime(path)) return "video";
  return null;
}

/** The type a video tab tells the player; whether it can really play it is the webview's call. */
export function videoMime(path: string): string | null {
  if (/\.(mp4|m4v)$/i.test(path)) return "video/mp4";
  if (/\.mov$/i.test(path)) return "video/quicktime";
  if (/\.webm$/i.test(path)) return "video/webm";
  return null;
}
