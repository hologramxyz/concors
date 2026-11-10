import { useGitHubStatus } from "@/github/use-github-status";

/** The native glass trigger and DOM avatars resolve the same cached profile photo. */
export function useAccountImage(
  user: { image?: string | null } | null | undefined,
  githubEnabled = false,
) {
  const github = useGitHubStatus(githubEnabled);
  const loading = githubEnabled && github.data === null && !github.error;
  const login = githubEnabled && github.data?.connected ? github.data.login : null;
  return {
    loading,
    src: login ? `https://github.com/${encodeURIComponent(login)}.png?size=96` : user?.image,
  };
}
