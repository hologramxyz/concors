import { api } from "@/auth/api";
import { apiCache, useApiResource } from "@/data/api-resource";

const key = "github:status";
const request = () => api.githubStatus();

/** Account identity only: displaying an avatar must not fetch installations or repositories. */
export function githubStatusResource() {
  return apiCache().resource(key, request);
}

export function useGitHubStatus(enabled = true) {
  return useApiResource(key, request, { enabled });
}
