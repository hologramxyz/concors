import type { ExpoConfig } from "expo/config";
import { version } from "./package.json";

const variant = process.env.APP_VARIANT ?? "development";
if (!["development", "preview", "production"].includes(variant))
  throw new Error("APP_VARIANT must be development, preview or production.");
const production = variant === "production";
// Static web previews may share standard HTTPS with other apps under a dedicated path.
// Do not change production/native release routing or accept an external asset origin here.
const webBasePath = process.env.CONCORS_MOBILE_WEB_BASE_PATH;
if (webBasePath && (production || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(webBasePath)))
  throw new Error(
    "CONCORS_MOBILE_WEB_BASE_PATH requires a preview build and an absolute URL path.",
  );
const identifier = "dev.concors.mobile";
const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

const config: ExpoConfig = {
  name: production ? "Concors" : "Concors Preview",
  slug: "concors-mobile",
  version,
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
    softwareKeyboardLayoutMode: "resize",
    package: production ? identifier : `${identifier}.preview`,
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#f4f3ef",
      monochromeImage: "./assets/notification-icon.png",
    },
    blockedPermissions: [
      "android.permission.CAMERA",
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
  ...(webBasePath ? { experiments: { baseUrl: webBasePath } } : {}),
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    ["expo-dev-client", { addGeneratedScheme: variant === "development" }],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash.png",
        imageWidth: 160,
        backgroundColor: "#f4f3ef",
        dark: { image: "./assets/splash-dark.png", backgroundColor: "#141414" },
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#202020",
        defaultChannel: "agent-attention",
      },
    ],
  ],
  ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
  extra: { variant, ...(projectId ? { eas: { projectId } } : {}) },
};

export default config;
