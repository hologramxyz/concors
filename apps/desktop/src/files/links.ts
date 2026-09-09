export interface FileLocation {
  path: string;
  line?: number;
}
/** Normalize agent paths and Markdown links without sending arbitrary machine paths to the API. */
export function resolveFileLink(href: string, root: string, sourcePath = ""): FileLocation | null {
  if (!href || href.startsWith("#") || href.startsWith("//") || href.startsWith("\\\\"))
    return null;
  let value = href;
  if (/^file:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return null;
      value = url.pathname + url.hash;
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (value.includes("\0")) return null;
  const suffix = value.match(/(?:#L?(\d+)(?:C\d+)?(?:-L?\d+)?|:(\d+)(?::\d+)?)$/i);
  const line = suffix ? Number(suffix[1] ?? suffix[2]) : undefined;
  if (suffix) value = value.slice(0, -suffix[0].length);
  value = value.replaceAll("\\", "/");
  let base = root.replaceAll("\\", "/").replace(/\/$/, "");
  if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
  const windows = /^[A-Za-z]:\//.test(base);
  if (windows) {
    base = base.slice(0, 1).toLowerCase() + base.slice(1);
    value = value.replace(/^[A-Za-z]:/, (match) => match.toLowerCase());
  }
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    if (!value.startsWith(base + "/")) return null;
    value = value.slice(base.length + 1);
  } else if (sourcePath) value = sourcePath.split("/").slice(0, -1).concat(value).join("/");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  if (!parts.length) return null;
  return { path: parts.join("/"), ...(line && Number.isSafeInteger(line) ? { line } : {}) };
}
