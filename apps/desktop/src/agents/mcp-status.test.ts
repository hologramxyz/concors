import { expect, it } from "vitest";
import { mcpStatusLabel } from "./mcp-status";

it("reads each agent's MCP status words as one set of labels", () => {
  expect(mcpStatusLabel("connected")).toEqual({ label: "Connected", tone: "ok" });
  expect(mcpStatusLabel("failed")).toEqual({ label: "Failed to start", tone: "error" });
  // Claude Code, OpenCode and Codex each name "needs sign-in" differently.
  for (const status of ["needs-auth", "needs_auth", "needs_client_registration", "notLoggedIn"])
    expect(mcpStatusLabel(status).label).toBe("Needs sign-in");
  expect(mcpStatusLabel("oAuth").label).toBe("Signed in");
  expect(mcpStatusLabel("unsupported").label).toBe("Configured");
  expect(mcpStatusLabel("something new").label).toBe("Configured");
});
