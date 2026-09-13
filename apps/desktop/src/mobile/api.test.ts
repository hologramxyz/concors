import { beforeEach, expect, it, vi } from "vitest";
import { MobileApiCallSchema, type MobileState } from "@concors/client-core";
import { api, getApiCacheScope } from "./api";
import { getHostState, hostAction } from "./bridge";

vi.mock("./bridge", () => ({
  hostAction: vi.fn().mockResolvedValue([]),
  getHostState: vi.fn(() => null),
}));
beforeEach(() => vi.clearAllMocks());

it("scopes shared data caches to the opaque host session without requesting or exposing tokens", () => {
  expect(getApiCacheScope()).toBeNull();
  vi.mocked(getHostState).mockReturnValue({ scope: "first-session" } as MobileState);
  expect(getApiCacheScope()).toBe("first-session");
  vi.mocked(getHostState).mockReturnValue({ scope: "second-session" } as MobileState);
  expect(getApiCacheScope()).toBe("second-session");
  vi.mocked(getHostState).mockReturnValue(null);
  expect(getApiCacheScope()).toBeNull();
  expect(hostAction).not.toHaveBeenCalled();
  expect(Object.keys(api)).not.toContain("tokens");
});

it("forwards only explicitly allowlisted and validated calls", async () => {
  await expect(api.listMachines({ organizationId: "org-one" })).resolves.toEqual([]);
  expect(hostAction).toHaveBeenCalledExactlyOnceWith({
    kind: "api",
    call: { method: "listMachines", args: [{ organizationId: "org-one" }] },
  });
  expect(Object.keys(api)).toEqual(
    MobileApiCallSchema.options.map((option) => option.shape.method.value),
  );
  await expect(api.getMachine("")).rejects.toThrow();
  expect(hostAction).toHaveBeenCalledTimes(1);
});

it("rejects newly added desktop methods locally without crashing shared settings", async () => {
  for (const method of ["listMachineSubscriptions", "createBillingSetup", "fetch", "constructor"]) {
    const call = Reflect.get(api, method) as () => Promise<unknown>;
    await expect(call()).rejects.toMatchObject({
      status: 409,
      code: "MOBILE_FEATURE_UNAVAILABLE",
      message: "This account feature is not available on mobile yet. Use the desktop app.",
    });
  }
  expect(hostAction).not.toHaveBeenCalled();
  expect(Reflect.get(api, "then")).toBeUndefined();
  expect(Reflect.get(api, Symbol.toStringTag)).toBeUndefined();
});
