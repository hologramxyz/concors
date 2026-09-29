import { useQuery } from "@tanstack/react-query";
import { api } from "./runtime";
import { tokenStore } from "../platform/storage";

/** Public provider discovery still uses ApiClient, which reads the secure session store. */
export function useSignInProviders(enabled: boolean) {
  const query = useQuery({
    queryKey: ["sign-in-providers", api.baseUrl],
    enabled,
    queryFn: async () => {
      // On a native cold start even a signed-out device must finish reading SecureStore first.
      await tokenStore.hydrate();
      return api.getSignInProviders();
    },
    retry: 2,
    retryDelay: (attempt) => 1_000 * 2 ** attempt,
    staleTime: 60_000,
    // RootLayout connects React Query's focus manager to native AppState.
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const providers = query.data;
  return {
    available: enabled && !!providers && (providers.github || providers.google || providers.email),
    checking: enabled && query.data === undefined && query.isFetching,
    error:
      enabled && query.data === undefined && query.isError
        ? "Could not reach Concors to start sign-in. Check your connection and retry."
        : null,
    retry: async () => {
      // refetch() ignores enabled, so guard demo, direct-daemon and web callers explicitly.
      if (enabled) await query.refetch();
    },
  };
}
