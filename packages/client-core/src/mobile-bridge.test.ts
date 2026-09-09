import { describe, expect, it } from "vitest";
import {
  MobileApiCallSchema,
  MobilePreferencesSchema,
  parseMobileRendererMessage,
} from "./mobile-bridge.ts";
describe("mobile host boundary", () => {
  it("does not expose credentials, connection tickets, arbitrary URLs or method invocation", () => {
    for (const method of [
      "fetch",
      "tokens",
      "connectMachine",
      "signInWithEmail",
      "getMe",
      "__proto__",
      "constructor",
    ])
      expect(MobileApiCallSchema.safeParse({ method, args: [] }).success).toBe(false);
    expect(
      parseMobileRendererMessage({
        type: "action",
        scope: "one",
        requestId: crypto.randomUUID(),
        action: { kind: "evaluate", code: "alert(1)" },
      }),
    ).toBeNull();
  });
  it("validates arguments, sizes and supported device preferences", () => {
    expect(MobileApiCallSchema.safeParse({ method: "listMachines", args: [] }).success).toBe(true);
    expect(
      MobileApiCallSchema.safeParse({ method: "listMachines", args: [{ organizationId: "org" }] })
        .success,
    ).toBe(true);
    expect(
      MobileApiCallSchema.safeParse({
        method: "createMachine",
        args: [{ name: "", size: "medium", region: "us" }],
      }).success,
    ).toBe(false);
    expect(MobilePreferencesSchema.safeParse({ theme: "light", corners: "subtle" }).success).toBe(
      true,
    );
    expect(MobilePreferencesSchema.safeParse({ theme: "custom", corners: "sharp" }).success).toBe(
      false,
    );
  });
  it("ignores malformed, oversized and unauthenticated envelopes", () => {
    expect(parseMobileRendererMessage("not json")).toBeNull();
    expect(parseMobileRendererMessage(" ".repeat(5_000_001))).toBeNull();
    expect(parseMobileRendererMessage({ type: "action", action: { kind: "sign-out" } })).toBeNull();
    expect(
      parseMobileRendererMessage({ type: "protocol", message: { type: "workspace.subscribe" } }),
    ).toBeNull();
    expect(parseMobileRendererMessage(JSON.stringify({ type: "ready" }))).toEqual({
      type: "ready",
    });
  });
});
