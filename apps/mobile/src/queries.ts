import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth/provider";
import { api } from "./auth/runtime";

export function useMachines() {
  const { me } = useAuth();
  const organizationId = me?.session.activeOrganizationId;
  return useQuery({
    queryKey: ["machines", me?.user.id, organizationId],
    // Bind the request as well as its cache key; a concurrent organization switch
    // must not put the server's new active-organization list under the old key.
    queryFn: () => api.listMachines(organizationId ? { organizationId } : undefined),
    enabled: !!me,
    refetchInterval: 15_000,
  });
}
export function useCapabilities() {
  const { me } = useAuth();
  return useQuery({
    queryKey: ["mobile-capabilities", me?.user.id],
    queryFn: () => api.getMobileCapabilities(),
    enabled: !!me,
    staleTime: 60_000,
  });
}
