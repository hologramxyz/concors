import type { ApiClient } from "@concors/api-client";
import { MobileApiCallSchema, type MobileApiCall } from "@concors/client-core";
import { hostAction } from "./bridge";

// The mobile Vite entry aliases the desktop API singleton to this allowlisted native RPC.
// A validated call never exposes tokens or a generic network primitive to the renderer.
export const api = Object.fromEntries(
  MobileApiCallSchema.options.map((option) => {
    const method = option.shape.method.value;
    return [
      method,
      (...args: unknown[]) =>
        hostAction({ kind: "api", call: MobileApiCallSchema.parse({ method, args }) }),
    ];
  }),
) as Pick<ApiClient, MobileApiCall["method"]>;
