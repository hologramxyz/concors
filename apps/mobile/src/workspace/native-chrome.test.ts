import { expect, it } from "vitest";
import {
  currentNativeSnapshot,
  reconcileNativeDraft,
  type NativeSurfaceSnapshot,
} from "./native-chrome-types";
import {
  MobileHostMessageSchema,
  NativeSurfaceEventSchema,
  parseMobileRendererMessage,
  type MobileState,
} from "@concors/client-core";

it("rejects stale scopes and daemon connections before showing native controls", () => {
  const host = {
    scope: "account-a",
    connectionId: "connection-a",
    nativeChrome: true,
  } as MobileState;
  const snapshot: NativeSurfaceSnapshot = {
    type: "native-surfaces",
    scope: host.scope,
    connectionId: host.connectionId,
    surfaces: [],
    viewport: { width: 390, height: 844 },
  };
  expect(currentNativeSnapshot(host, snapshot)).toBe(true);
  expect(currentNativeSnapshot({ ...host, scope: "account-b" }, snapshot)).toBe(false);
  expect(currentNativeSnapshot({ ...host, connectionId: "connection-b" }, snapshot)).toBe(false);
  expect(currentNativeSnapshot({ ...host, nativeChrome: false }, snapshot)).toBe(false);
  expect(currentNativeSnapshot(host, null)).toBe(false);
});
it("does not overwrite newer typing with an older native bridge echo", () => {
  expect(reconcileNativeDraft("hello", 5, "hell", 4)).toBe("hello");
  expect(reconcileNativeDraft("hello", 5, "hello", 5)).toBe("hello");
  expect(reconcileNativeDraft("hello", 5, "", 5)).toBe("");
});
it("bounds the native UI protocol and carries the final text with submission", () => {
  expect(
    NativeSurfaceEventSchema.safeParse({ kind: "press", control: "send", text: "final keystroke" })
      .success,
  ).toBe(true);
  expect(
    NativeSurfaceEventSchema.safeParse({ kind: "text", text: "x".repeat(16001), sequence: 1 })
      .success,
  ).toBe(false);
  expect(NativeSurfaceEventSchema.safeParse({ kind: "height", height: Infinity }).success).toBe(
    false,
  );
  expect(
    NativeSurfaceEventSchema.safeParse({ kind: "text", text: "ok", sequence: -1 }).success,
  ).toBe(false);
  expect(NativeSurfaceEventSchema.safeParse({ kind: "eval", script: "alert(1)" }).success).toBe(
    false,
  );
  expect(
    MobileHostMessageSchema.safeParse({
      type: "native-event",
      scope: "a",
      connectionId: null,
      surfaceId: "b",
      event: { kind: "swipe", direction: "left" },
    }).success,
  ).toBe(true);
  expect(
    parseMobileRendererMessage({
      type: "native-surfaces",
      scope: "a",
      connectionId: null,
      surfaces: [],
      viewport: { width: 0, height: 844 },
    }),
  ).toBeNull();
});
