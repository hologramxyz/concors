import { HydratedTokenStore, MachineCredentialStore } from "@concors/client-core";

// Browser preview deliberately keeps credentials in memory. Native builds use SecureStore.
// The preview cannot run the in-app sign-in sheet, so the acceptance tests start their development
// server with a session instead. A production bundle never reads it.
let token: string | null =
  (process.env.NODE_ENV !== "production" && process.env.EXPO_PUBLIC_E2E_SESSION_TOKEN) || null;
export const tokenStore = new HydratedTokenStore({
  read: async () => token,
  write: async (value) => {
    token = value;
  },
});
const values = new Map<string, string>();
// Persist appearance and shortcut preferences in the browser preview, just as the native
// host does. Credentials and every other value remain in memory.
const preferenceKey = (key: string) => (key === "appearance.v1" ? `concors.mobile.${key}` : null);
export const deviceStorage = {
  get: async (key: string) => {
    const persisted = preferenceKey(key);
    if (persisted && typeof localStorage !== "undefined") {
      try {
        return localStorage.getItem(persisted);
      } catch {
        /* Use this session's value. */
      }
    }
    return values.get(key) ?? null;
  },
  set: async (key: string, value: string | null) => {
    const persisted = preferenceKey(key);
    if (persisted && typeof localStorage !== "undefined") {
      if (value === null) localStorage.removeItem(persisted);
      else localStorage.setItem(persisted, value);
    }
    if (value === null) values.delete(key);
    else values.set(key, value);
  },
};

export const machineCredentials = new MachineCredentialStore({
  read: () => deviceStorage.get("machine-token.v1"),
  write: (value) => deviceStorage.set("machine-token.v1", value),
});
