import { expect, it, vi } from "vitest";
vi.mock("../config", () => ({ config: { apiUrl: "https://api.concors.dev" } }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
import * as SecureStore from "expo-secure-store";
import { machineCredentials, tokenStore } from "./storage";

it("ignores legacy unscoped sessions and stores new sessions with their API identity", async () => {
  await tokenStore.hydrate();
  expect(SecureStore.getItemAsync).toHaveBeenCalledWith("concors.mobile.session.v2");
  expect(SecureStore.getItemAsync).not.toHaveBeenCalledWith("concors.mobile.session.v1");
  tokenStore.set("account-fixture");
  await tokenStore.flush();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    "concors.mobile.session.v2",
    JSON.stringify({ apiUrl: "https://api.concors.dev", token: "account-fixture" }),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
  tokenStore.set(null);
  await tokenStore.flush();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("concors.mobile.session.v2");
});

it("stores native machine tokens only in device-bound SecureStore and deletes on disconnect", async () => {
  const connection = machineCredentials.begin("user:organization", "cloud-id");
  await connection.save("machine-secret");
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    "concors.mobile.machine-token.v1",
    JSON.stringify({ scope: "user:organization", machineId: "cloud-id", token: "machine-secret" }),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
  await connection.clear();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("concors.mobile.machine-token.v1");
});
