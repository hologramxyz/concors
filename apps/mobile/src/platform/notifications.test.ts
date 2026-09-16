import { expect, it, vi } from "vitest";
import type { ApiClient } from "@concors/api-client";
vi.mock("react-native", () => ({ AppState: {}, Platform: { OS: "ios" } }));
vi.mock("expo-device", () => ({ isDevice: true }));
vi.mock("expo-crypto", () => ({ randomUUID: vi.fn() }));
vi.mock("expo-router", () => ({ router: {} }));
vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
}));
vi.mock("../config", () => ({ config: { personalTeam: true, projectId: "unused-project" } }));
vi.mock("./storage", () => ({ deviceStorage: { get: vi.fn(), set: vi.fn() } }));
import * as Notifications from "expo-notifications";
import { enablePush, pushEnabled } from "./notifications";

it("rejects push before requesting permissions or tokens in a Personal Team build", async () => {
  const registerPushDevice = vi.fn();
  await expect(
    enablePush({ registerPushDevice } as unknown as ApiClient, "test-user"),
  ).rejects.toThrow("free Personal Team");
  expect(await pushEnabled("test-user")).toBe(false);
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(registerPushDevice).not.toHaveBeenCalled();
});
