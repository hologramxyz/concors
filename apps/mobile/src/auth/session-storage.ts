import type { CredentialStorage } from "@concors/client-core";

/** A session issued by one backend must never authenticate requests to another. */
export function apiSessionStorage(apiUrl: string, storage: CredentialStorage): CredentialStorage {
  const scope = new URL(apiUrl).href.replace(/\/$/, "");
  return {
    async read() {
      const raw = await storage.read();
      if (!raw) return null;
      try {
        const record = JSON.parse(raw);
        return record?.apiUrl === scope && typeof record.token === "string" && record.token
          ? record.token
          : null;
      } catch {
        return null;
      }
    },
    write: (token) =>
      storage.write(token === null ? null : JSON.stringify({ apiUrl: scope, token })),
  };
}
