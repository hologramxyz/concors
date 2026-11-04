import { expect, it } from "vitest";
import { accessHint, errorMessage, firstNotificationProblem, notificationProblem } from "./access";

it("tells people on macOS how to fix each permission state", () => {
  expect(accessHint("allowed", true)).toMatchObject({ tone: "ok" });
  expect(accessHint("blocked", true)).toMatchObject({ tone: "warning", action: "settings" });
  // Allowed with the alert style set to None never shows a banner, so it is not "fine".
  expect(accessHint("quiet", true)).toMatchObject({ tone: "warning", action: "settings" });
  expect(accessHint("not_asked", true)).toMatchObject({ action: "request" });
  // Linux and Windows cannot read the state; saying nothing beats guessing.
  expect(accessHint("unknown", true)).toBeNull();
});

it("never offers System Settings to a browser that blocks notifications", () => {
  expect(accessHint("blocked", false)?.action).toBeUndefined();
  expect(accessHint("unsupported", false)).toMatchObject({ tone: "warning" });
});

it("reads the reason from Tauri's string rejections as well as errors", () => {
  expect(errorMessage("afplay: Error: AudioQueueStart failed", "fallback")).toBe(
    "afplay: Error: AudioQueueStart failed",
  );
  expect(errorMessage(new Error("blocked"), "fallback")).toBe("blocked");
  expect(errorMessage(undefined, "fallback")).toBe("fallback");
});

it("turns macOS's refusal into plain words with a way to fix it", () => {
  const refused =
    "macOS could not ask to allow notifications: The operation couldn’t be completed. (UNErrorDomain error 1.)";
  expect(notificationProblem(refused, "not_asked", true)).toEqual({
    message: "Notifications are off for Concors",
    settings: true,
  });
  expect(notificationProblem("Anything", "blocked", true).settings).toBe(true);
  // A browser's own message already says what to change, and there is no settings page to open.
  const browser = "Your browser is blocking notifications from Concors.";
  expect(notificationProblem(browser, "blocked", false)).toEqual({
    message: `A desktop notification could not be shown: ${browser}`,
    settings: false,
  });
});

it("reports a problem once a session", () => {
  expect(firstNotificationProblem()).toBe(true);
  expect(firstNotificationProblem()).toBe(false);
});
