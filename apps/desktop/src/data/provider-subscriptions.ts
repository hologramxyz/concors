import { api } from "@/auth/api";
import { useApiResource } from "./api-resource";

/** The signed-in person's subscription library, kept by the control plane for every computer. */
export function useProviderSubscriptions(enabled: boolean) {
  return useApiResource("provider-subscriptions", () => api.listProviderSubscriptions(), {
    enabled,
  });
}
