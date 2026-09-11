// Isolate parallel acceptance runs without reusing another checkout's daemon.
function port(key: string, fallback: number) {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${key}`);
  return value;
}
export const mobileDirectPort = port("CONCORS_MOBILE_DIRECT_PORT", 7440);
export const mobileWebPort = port("CONCORS_MOBILE_WEB_PORT", 8087);
export const mobileWebOrigin = `http://localhost:${mobileWebPort}`;
export const mobileDirectSocket = `ws://localhost:${mobileDirectPort}/ws`;
export const mobileDesktopSocket = `ws://127.0.0.1:${mobileDirectPort}/ws`;
