import type { ProcessPreview } from "@concors/protocol";

/**
 * Agents run on the machine, so the dev servers they link live at `localhost` there, which the
 * browser on this computer cannot reach when the machine is remote. These helpers recognise such
 * links so the chat can open them through the connection's preview address instead. They do not
 * check that anything is listening; the gateway answers for a dead port like any other preview.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"]);

export interface LocalPreviewLink {
  preview: ProcessPreview;
  /** Path and query to keep when the link is rewritten; the fragment carries preview access. */
  path: string;
}

export function localPreviewLink(href: string): LocalPreviewLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK.has(host) && !host.endsWith(".localhost")) return null;
  const protocol = url.protocol === "https:" ? "https" : "http";
  const port = url.port ? Number(url.port) : protocol === "https" ? 443 : 80;
  return { preview: { port, protocol }, path: url.pathname + url.search };
}

/** The preview address for a local link, keeping the page the agent pointed at. */
export function previewLinkUrl(link: LocalPreviewLink, previewUrl: string): string {
  const url = new URL(previewUrl);
  const target = new URL(link.path, "http://preview");
  url.pathname = target.pathname;
  url.search = target.search;
  return url.href;
}

/**
 * Links that point at files on the machine rather than at the web: `file:`, Windows drive paths,
 * `name.ext:line` references, and anything without a scheme.
 */
export function isFileLink(href: string): boolean {
  return (
    /^file:\/\//i.test(href) ||
    /^[a-z]:[\\/]/i.test(href) ||
    /^[^:/]+\.[^:/]+:\d+(?::\d+)?$/.test(href) ||
    !/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)
  );
}
