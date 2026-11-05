import { expect, it } from "vitest";
import {
  contextRingStroke,
  contextRingValue,
  currentNativeSnapshot,
  nativeSurfaceLayout,
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
it("clips native controls without resizing their glass or label", () => {
  const surface = {
    id: "search",
    content: { kind: "button", icon: "search", label: "Search", title: "", disabled: false },
    frame: { x: 264, y: 70, width: 44, height: 44 },
    clip: { x: 264, y: 70, width: 16, height: 44 },
    interactive: false,
  } as const;
  const viewport = { width: 390, height: 844 };
  // Cut only at the panel's edge on the right; the other sides leave room for the glass's shadow.
  expect(nativeSurfaceLayout(surface, viewport, viewport)).toEqual({
    clip: { left: 216, top: 22, width: 64, height: 140 },
    content: { left: 48, top: 48, width: 44, height: 44 },
  });
  expect(nativeSurfaceLayout({ ...surface, clip: surface.frame }, viewport, viewport)).toEqual({
    clip: { left: 216, top: 22, width: 140, height: 140 },
    content: { left: 48, top: 48, width: 44, height: 44 },
  });
  expect(nativeSurfaceLayout(surface, viewport, { width: 780, height: 844 }).content.width).toBe(
    88,
  );
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

it("draws only the used share of the context ring, whatever a provider reports", () => {
  const circumference = Math.PI * 14;
  const stroke = (percent: number) => contextRingStroke(percent, 16, 2);
  expect(stroke(0)).toEqual({
    lineWidth: 2,
    dash: [circumference, circumference],
    dashPhase: circumference,
  });
  expect(stroke(50).dashPhase).toBeCloseTo(circumference / 2);
  expect(stroke(100).dashPhase).toBe(0);
  expect(stroke(140).dashPhase).toBe(0);
  expect(stroke(-5).dashPhase).toBe(circumference);
});

it("says what the context ring holds in desktop's words", () => {
  expect(contextRingValue(null)).toBe("Usage pending");
  expect(contextRingValue(6.2)).toBe("6% context used");
  expect(contextRingValue(0)).toBe("0% context used");
});
