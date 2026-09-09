import { describe, expect, it } from "vitest";
import { apiUrl, isPreviewVariant } from "./runtime-config";
describe("production configuration", () => {
  it("only enables fixtures and private gateways in explicit preview variants", () => {
    expect(isPreviewVariant("development")).toBe(true);
    expect(isPreviewVariant("preview")).toBe(true);
    for (const value of ["production", undefined, null, "typo"])
      expect(isPreviewVariant(value)).toBe(false);
  });
  it("requires HTTPS in production, allowing HTTP loopback only in development", () => {
    expect(apiUrl("https://api.example/", false)).toBe("https://api.example");
    expect(apiUrl("http://localhost:4000", true)).toBe("http://localhost:4000");
    for (const url of [
      "http://localhost:4000",
      "https://user:secret@api.example",
      "https://api.example?token=secret",
      "https://api.example/#token",
    ])
      expect(() => apiUrl(url, false)).toThrow();
    expect(() => apiUrl("http://public.example", true)).toThrow();
  });
});
