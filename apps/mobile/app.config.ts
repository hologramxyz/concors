import type { ExpoConfig } from "expo/config";

const variant = process.env.APP_VARIANT ?? "development";
const production = variant === "production";
const identifier = "dev.concors.mobile";
const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

const config: ExpoConfig = {
  name: production ? "Concors" : "Concors Preview",
  slug: "concors-mobile",
  version: "0.1.0",
  scheme: production ? "concors" : "concors-preview",
  platforms: ["ios", "android", "web"],
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: production ? identifier : `${identifier}.preview`,
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
    },
    ...(production ? { associatedDomains: ["applinks:concors.dev"] } : {}),
  },
  android: {
    package: production ? identifier : `${identifier}.preview`,
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#f4f3ef",
      monochromeImage: "./assets/notification-icon.png",
    },
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      ...(production ? ["android.permission.SYSTEM_ALERT_WINDOW"] : []),
    ],
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
    ...(production
      ? {
          intentFilters: [
            {
              action: "VIEW",
              autoVerify: true,
              category: ["BROWSABLE", "DEFAULT"],
              data: [{ scheme: "https", host: "concors.dev", pathPrefix: "/session" }],
            },
          ],
        }
      : {}),
  },
  web: { bundler: "metro", output: "single", favicon: "./assets/icon.png" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash.png",
        imageWidth: 160,
        backgroundColor: "#f4f3ef",
        dark: { backgroundColor: "#151714" },
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#335dce",
        defaultChannel: "agent-attention",
      },
    ],
  ],
  ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
  extra: { variant, ...(projectId ? { eas: { projectId } } : {}) },
};

export default config;
