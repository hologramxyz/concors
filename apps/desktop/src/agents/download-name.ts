const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/** The file name to save under: an image the agent named only in prose still gets an extension. */
export function downloadName(name: string, mime: string): string {
  const extension = EXTENSIONS[mime];
  return extension && !/\.[A-Za-z0-9]{1,5}$/.test(name) ? `${name}.${extension}` : name;
}
