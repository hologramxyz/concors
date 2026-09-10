import * as SecureStore from "expo-secure-store";
import { HydratedTokenStore } from "@concors/client-core";

const KEY = "concors.mobile.session.v1";
export const tokenStore = new HydratedTokenStore({
  read: () => SecureStore.getItemAsync(KEY),
  write: (token) =>
    token === null
      ? SecureStore.deleteItemAsync(KEY)
      : SecureStore.setItemAsync(KEY, token, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
});
export const deviceStorage = {
  get: (key: string) => SecureStore.getItemAsync(`concors.mobile.${key}`),
  set: (key: string, value: string | null) =>
    value === null
      ? SecureStore.deleteItemAsync(`concors.mobile.${key}`)
      : SecureStore.setItemAsync(`concors.mobile.${key}`, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
};
