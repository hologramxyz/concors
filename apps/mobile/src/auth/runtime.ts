import { createApiClient } from "@concors/api-client";
import { Platform } from "react-native";
import { config } from "../config";
import { tokenStore } from "../platform/storage";
import { createMobileApiFetch } from "./api-fetch";

export const demo = config.demo
  ? import("../demo/server").then(({ createDemoServer }) => createDemoServer())
  : null;
// No Vite proxy or browser cookies are needed by the native app: ApiClient sends a bearer token.
const liveFetch = createMobileApiFetch({ apiUrl: config.apiUrl, native: Platform.OS !== "web" });
const nativeFetch: typeof fetch = async (input, init) => {
  if (config.developmentDaemon)
    throw new Error("Cloud API calls are disabled in direct-daemon mode.");
  if (demo) return (await demo).fetch(input, init);
  return liveFetch(input, init);
};
export const api = createApiClient({ baseUrl: config.apiUrl, tokenStore, fetch: nativeFetch });
