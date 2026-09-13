import { ApiError, type ApiClient } from "@concors/api-client";
import { MobileApiCallSchema, type MobileApiCall } from "@concors/client-core";
import { getHostState, hostAction } from "./bridge";

/** Cache isolation follows the native account scope; credentials stay in the host. */
export function getApiCacheScope() {
  return getHostState()?.scope ?? null;
}

// The mobile Vite entry aliases the desktop API singleton to this allowlisted native RPC.
// A validated call never exposes tokens or a generic network primitive to the renderer.
const allowlisted = Object.fromEntries(
  MobileApiCallSchema.options.map((option) => {
    const method = option.shape.method.value;
    return [
      method,
      async (...args: unknown[]) =>
        hostAction({ kind: "api", call: MobileApiCallSchema.parse({ method, args }) }),
    ];
  }),
) as Pick<ApiClient, MobileApiCall["method"]>;

// Shared desktop views may acquire API methods before mobile explicitly supports them.
// Reject those calls locally through their existing error UI, rather than crashing the
// entire workspace or silently granting the renderer new host/network permissions.
export const api = new Proxy(allowlisted, {
  get(target, property, receiver) {
    if (Object.hasOwn(target, property)) return Reflect.get(target, property, receiver);
    if (typeof property !== "string" || property === "then") return undefined;
    return async () => {
      throw new ApiError(
        409,
        "This account feature is not available on mobile yet. Use the desktop app.",
        "MOBILE_FEATURE_UNAVAILABLE",
      );
    };
  },
});
