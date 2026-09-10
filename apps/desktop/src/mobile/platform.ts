/** Local WebViews may expose secure random bytes without the secure-context UUID helper. */
export function installRandomUUID(
  source: Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">>,
) {
  if (typeof source.randomUUID === "function") return;
  Object.defineProperty(source, "randomUUID", {
    configurable: true,
    value: () => {
      const bytes = source.getRandomValues(new Uint8Array(16));
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}
