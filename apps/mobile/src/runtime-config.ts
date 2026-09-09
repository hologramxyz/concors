export function isPreviewVariant(value: unknown): boolean {
  return value === "development" || value === "preview";
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
