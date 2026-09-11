/* global process, module */
// CommonJS is shared by the ESM fixture/config and Playwright's CJS-transformed tests.
// Isolate parallel acceptance runs without reusing another checkout's daemon.
/** @param {string} key @param {number} fallback */
function port(key, fallback) {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${key}`);
  return value;
}
const mobileDirectPort = port("CONCORS_MOBILE_DIRECT_PORT", 7440);
const mobileWebPort = port("CONCORS_MOBILE_WEB_PORT", 8087);
const mobileWebOrigin = `http://localhost:${mobileWebPort}`;
const mobileDirectSocket = `ws://localhost:${mobileDirectPort}/ws`;
const mobileDesktopSocket = `ws://127.0.0.1:${mobileDirectPort}/ws`;
module.exports = {
  mobileDirectPort,
  mobileWebPort,
  mobileWebOrigin,
  mobileDirectSocket,
  mobileDesktopSocket,
};
