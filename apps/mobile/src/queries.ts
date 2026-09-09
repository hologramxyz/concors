import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth/provider";
import { api } from "./auth/runtime";

export function useMachines() {
  const { me } = useAuth();
  return useQuery({
    queryKey: ["machines", me?.user.id, me?.session.activeOrganizationId],
    queryFn: () => api.listMachines(),
    enabled: !!me,
    refetchInterval: 30_000,
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
