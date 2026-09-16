import * as SecureStore from "expo-secure-store";
import { HydratedTokenStore, MachineCredentialStore } from "@concors/client-core";
import { config } from "../config";
import { apiSessionStorage } from "../auth/session-storage";

// Never import the unscoped v1 token: its issuing backend cannot be established safely.
const KEY = "concors.mobile.session.v2";
export const tokenStore = new HydratedTokenStore(
  apiSessionStorage(config.apiUrl, {
    read: () => SecureStore.getItemAsync(KEY),
    write: (token) =>
      token === null
        ? SecureStore.deleteItemAsync(KEY)
        : SecureStore.setItemAsync(KEY, token, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          }),
  }),
);
export const deviceStorage = {
  get: (key: string) => SecureStore.getItemAsync(`concors.mobile.${key}`),
  set: (key: string, value: string | null) =>
    value === null
      ? SecureStore.deleteItemAsync(`concors.mobile.${key}`)
      : SecureStore.setItemAsync(`concors.mobile.${key}`, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
};

export const machineCredentials = new MachineCredentialStore({
  read: () => deviceStorage.get("machine-token.v1"),
  write: (value) => deviceStorage.set("machine-token.v1", value),
});
