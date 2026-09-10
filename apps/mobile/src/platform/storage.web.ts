import { HydratedTokenStore, MachineCredentialStore } from "@concors/client-core";

// Browser preview deliberately keeps credentials in memory. Native builds use SecureStore.
let token: string | null = null;
export const tokenStore = new HydratedTokenStore({
  read: async () => token,
  write: async (value) => {
    token = value;
  },
});
const values = new Map<string, string>();
export const deviceStorage = {
  get: async (key: string) => values.get(key) ?? null,
  set: async (key: string, value: string | null) => {
    if (value === null) values.delete(key);
    else values.set(key, value);
  },
};

export const machineCredentials = new MachineCredentialStore({
  read: () => deviceStorage.get("machine-token.v1"),
  write: (value) => deviceStorage.set("machine-token.v1", value),
});
