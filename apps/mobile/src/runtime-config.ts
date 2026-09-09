export function isPreviewVariant(value: unknown): boolean {
  return value === "development" || value === "preview";
}
/** Direct access is opt-in, preview-only and protected by the operator's private tunnel. */
export function directDaemonUrl(value: string | undefined, variant: unknown): string | undefined {
  if (!value || !isPreviewVariant(variant)) return undefined;
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "wss:" && !(variant === "development" && loopback && url.protocol === "ws:"))
  )
    throw new Error("Use a private WSS daemon URL without credentials, query or fragment.");
  return url.href;
}
export function apiUrl(value: string, development: boolean): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(development && loopback && url.protocol === "http:"))
  )
    throw new Error("Use an HTTPS API URL (HTTP loopback is allowed for development).");
  return url.href.replace(/\/$/, "");
}
