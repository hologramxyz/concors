import { expect, it } from "vitest";
import { accessHint, errorMessage } from "./access";

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
