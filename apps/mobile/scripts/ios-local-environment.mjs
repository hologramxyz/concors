export const defaultApi = "https://api.concors.dev";

/** Local-only defaults; never alter the production API or inherit a demo/private connection. */
export function localIosEnvironment(current) {
  if (current.EAS_BUILD_PROFILE || current.EAS_BUILD)
    throw new Error("Use this command locally on your Mac, not inside EAS Build.");
  let api;
  try {
    api = new URL(current.CONCORS_IOS_API_URL || defaultApi);
    if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash)
      throw new Error("Invalid URL");
  } catch {
    throw new Error(
      "CONCORS_IOS_API_URL must be an HTTPS API URL without credentials, query or fragment.",
    );
  }
  return {
    ...current,
    APP_VARIANT: "development",
    CONCORS_IOS_PERSONAL_TEAM: "true",
    EXPO_PUBLIC_API_URL: api.href.replace(/\/$/, ""),
    EXPO_PUBLIC_DEMO: "false",
    EXPO_PUBLIC_DEV_DAEMON_URL: "",
    EXPO_PUBLIC_EAS_PROJECT_ID: "",
    EXPO_OWNER: "",
    CONCORS_MOBILE_WEB_BASE_PATH: "",
    // A leftover TestFlight .env.local must not change the native identity or JS API.
    EXPO_NO_DOTENV: "1",
  };
}
