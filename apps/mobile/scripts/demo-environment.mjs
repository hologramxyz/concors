/** Demo/acceptance runs must never inherit a release backend or direct daemon. */
export function demoEnvironment(environment) {
  return {
    ...environment,
    EXPO_NO_DOTENV: "1",
    APP_VARIANT: "preview",
    EXPO_PUBLIC_DEMO: "true",
    EXPO_PUBLIC_DEV_DAEMON_URL: "",
    EXPO_PUBLIC_API_URL: "https://demo.concors.invalid",
  };
}
