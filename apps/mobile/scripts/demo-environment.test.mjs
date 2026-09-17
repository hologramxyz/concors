import { expect, it } from "vitest";
import { demoEnvironment } from "./demo-environment.mjs";

it("isolates demo runs from saved TestFlight and direct-daemon settings", () => {
  expect(
    demoEnvironment({
      APP_VARIANT: "production",
      EXPO_PUBLIC_DEMO: "false",
      EXPO_NO_DOTENV: "0",
      EXPO_PUBLIC_API_URL: "https://api.concors.dev",
      EXPO_PUBLIC_DEV_DAEMON_URL: "wss://private.example",
      CI: "1",
    }),
  ).toEqual({
    APP_VARIANT: "preview",
    EXPO_PUBLIC_DEMO: "true",
    EXPO_NO_DOTENV: "1",
    EXPO_PUBLIC_API_URL: "https://demo.concors.invalid",
    EXPO_PUBLIC_DEV_DAEMON_URL: "",
    CI: "1",
  });
});
