/**
 * Each agent reports its MCP servers in its own words: Claude Code and OpenCode say whether a
 * server connected, Codex only whether it is signed in. These are the plain labels the app shows.
 */
export function mcpStatusLabel(status: string): {
  label: string;
  tone: "ok" | "warning" | "error" | "muted";
} {
  switch (status) {
    case "connected":
      return { label: "Connected", tone: "ok" };
    case "failed":
      return { label: "Failed to start", tone: "error" };
    case "needs-auth":
    case "needs_auth":
    case "needs_client_registration":
    case "notLoggedIn":
      return { label: "Needs sign-in", tone: "warning" };
    case "pending":
      return { label: "Starting", tone: "muted" };
    case "disabled":
      return { label: "Turned off", tone: "muted" };
    case "bearerToken":
    case "oAuth":
      return { label: "Signed in", tone: "ok" };
    default:
      return { label: "Configured", tone: "muted" };
  }
}
