/** Files a tab shows read-only instead of in the editor. The machine checks the actual bytes. */
export type PreviewKind = "pdf" | "image";
export function previewKind(path: string): PreviewKind | null {
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.(png|jpe?g|gif|webp)$/i.test(path)) return "image";
  return null;
}
