import { describe, expect, it } from "vitest";
import {
  MobileApiCallSchema,
  MobileActionSchema,
  MobilePreferencesSchema,
  MobileStateSchema,
  parseMobileRendererMessage,
} from "./mobile-bridge.ts";
describe("mobile host boundary", () => {
  it("accepts bounded installation metadata and discards unrelated fields", () => {
    expect(
      MobileStateSchema.shape.app.parse({ version: "0.1.0", build: "12", token: "secret" }),
    ).toEqual({ version: "0.1.0", build: "12" });
    expect(MobileStateSchema.shape.app.parse(undefined)).toBeUndefined();
    expect(MobileStateSchema.shape.app.parse({ version: "0.1.0", build: null })).toEqual({
      version: "0.1.0",
      build: null,
    });
    expect(
      MobileStateSchema.shape.app.safeParse({ version: "0.1.0", build: "1".repeat(101) }).success,
    ).toBe(false);
  });
  it("preserves display-only profile avatars without forwarding account credentials", () => {
    const profile = {
      name: "Test User",
      email: "test@example.com",
      image: "https://github.com/test-user.png?size=96",
    };
    expect(
      MobileStateSchema.shape.profile.parse({ ...profile, token: "secret", password: "secret" }),
    ).toEqual(profile);
    expect(
      MobileStateSchema.shape.profile.parse({ name: "User", email: "user@example.com" }),
    ).toEqual({ name: "User", email: "user@example.com", image: null });
  });
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
  it("allows only bounded preview identities across the credential-free renderer bridge", () => {
    expect(
      MobileActionSchema.parse({
        kind: "open-preview",
        preview: { port: 5173, protocol: "http", token: "secret" },
        url: "https://attacker.example",
      }),
    ).toEqual({ kind: "open-preview", preview: { port: 5173, protocol: "http" } });
    for (const preview of [
      { port: 0, protocol: "http" },
      { port: 65536, protocol: "http" },
      { port: 5173, protocol: "file" },
    ])
      expect(MobileActionSchema.safeParse({ kind: "open-preview", preview }).success).toBe(false);
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
  it("bounds GitHub and machine metadata calls without exposing credentials", () => {
    for (const call of [
      { method: "githubStatus", args: [] },
      { method: "connectGitHub", args: [] },
      { method: "disconnectGitHub", args: [] },
      { method: "githubAccounts", args: [] },
      { method: "githubAccounts", args: [2] },
      { method: "githubRepositories", args: [123, 2] },
      { method: "prepareGitHubMachine", args: ["machine", "org/repo"] },
      { method: "renameMachine", args: ["machine", "build-server"] },
      { method: "updateMachineIcon", args: ["machine", "🚀"] },
      { method: "updateMachineIcon", args: ["machine", null] },
    ])
      expect(MobileApiCallSchema.safeParse(call).success, JSON.stringify(call)).toBe(true);
    for (const call of [
      { method: "githubAccounts", args: [0] },
      { method: "githubRepositories", args: [-1] },
      { method: "githubRepositories", args: [123, 1.5] },
      { method: "prepareGitHubMachine", args: ["machine", "https://other.example/repo"] },
      { method: "prepareGitHubMachine", args: ["machine", "org/.."] },
      { method: "renameMachine", args: ["machine", "invalid name"] },
      { method: "updateMachineIcon", args: ["machine", "text"] },
      { method: "githubToken", args: [] },
    ])
      expect(MobileApiCallSchema.safeParse(call).success, JSON.stringify(call)).toBe(false);
  });
});
