import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import type { ApiClient } from "@concors/api-client";
import { NotificationDeduplicator, notificationTarget, sessionHref } from "@concors/client-core";
import { config } from "../config";
import { deviceStorage } from "./storage";
import { serialTasks } from "./serial-task";

const ordered = serialTasks();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});
export function enablePush(api: ApiClient, userId: string): Promise<void> {
  return ordered(async () => {
    if (!Device.isDevice || !config.projectId)
      throw new Error("Notifications need a physical device and a configured Expo project.");
    if (Platform.OS === "android")
      await Notifications.setNotificationChannelAsync("agent-attention", {
        name: "Agent requests and completions",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted)
      throw new Error("Notifications are off. You can enable them in device settings.");
    await register(api, userId);
  });
}
async function register(api: ApiClient, userId: string): Promise<void> {
  if (!config.projectId) return;
  let installationId = await deviceStorage.get("installation-id");
  if (!installationId) {
    installationId = randomUUID();
    await deviceStorage.set("installation-id", installationId);
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: config.projectId })).data;
  await api.registerPushDevice({
    installationId,
    token,
    platform: Platform.OS === "ios" ? "ios" : "android",
  });
  await deviceStorage.set("push-user", userId);
}
export function disablePush(api: ApiClient): Promise<void> {
  return ordered(() => unregister(api));
}
async function unregister(api: ApiClient): Promise<void> {
  const enabled = await deviceStorage.get("push-user");
  const installationId = await deviceStorage.get("installation-id");
  await deviceStorage.set("push-user", null);
  if (enabled && installationId) await api.unregisterPushDevice(installationId);
}
export async function pushEnabled(userId: string): Promise<boolean> {
  return (await deviceStorage.get("push-user")) === userId;
}
export function usePushNavigation(
  api: ApiClient,
  userId: string | undefined,
  supported: boolean,
): void {
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    const seen = new NotificationDeduplicator();
    const navigate = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const target = notificationTarget(response.notification.request.content.data, userId);
      if (target && seen.accept(target.eventId)) router.push(sessionHref(target));
      Notifications.clearLastNotificationResponse();
    };
    navigate(Notifications.getLastNotificationResponse());
    const response = Notifications.addNotificationResponseReceivedListener(navigate);
    const refresh = () =>
      ordered(async () => {
        if (!supported || disposed || !(await pushEnabled(userId))) return;
        if (!(await Notifications.getPermissionsAsync()).granted) {
          await unregister(api);
          return;
        }
        if (!disposed) await register(api, userId);
      });
    const tokens = Notifications.addPushTokenListener(() => {
      void refresh().catch(() => undefined);
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch(() => undefined);
    });
    void refresh().catch(() => undefined);
    return () => {
      disposed = true;
      response.remove();
      tokens.remove();
      appState.remove();
    };
  }, [api, userId, supported]);
}
