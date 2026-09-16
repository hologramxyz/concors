import Constants from "expo-constants";
import { apiUrl, directDaemonUrl, isPreviewVariant } from "./runtime-config";

// Missing/unknown build metadata must not enable test credentials or gateway overrides.
const production = !isPreviewVariant(Constants.expoConfig?.extra?.variant);
const developmentDaemon = directDaemonUrl(
  process.env.EXPO_PUBLIC_DEV_DAEMON_URL,
  Constants.expoConfig?.extra?.variant,
);
if (developmentDaemon && process.env.EXPO_PUBLIC_DEMO === "true")
  throw new Error("Choose either the simulated demo or a live desktop daemon, not both.");
export const config = {
  apiUrl: apiUrl(process.env.EXPO_PUBLIC_API_URL ?? "https://api.concors.dev", !production),
  demo: !production && process.env.EXPO_PUBLIC_DEMO === "true",
  personalTeam: !production && Constants.expoConfig?.extra?.personalTeam === true,
  developmentDaemon,
  projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
  privacyUrl: "https://concors.dev/privacy",
  supportUrl: "https://concors.dev/support",
  deletionUrl: "https://concors.dev/account/delete",
};
