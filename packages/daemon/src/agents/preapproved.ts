/**
 * Whether a harness's permission request is for a Concors tool server the chat may use without
 * asking. Such a server enforces its limits in the daemon (Supervisor's control tool cannot answer
 * approvals, change permissions or type into terminals), so a prompt per call protects nothing.
 * Everything else the harness asks about keeps the chat's permission mode.
 *
 * Only names the harness itself supplies are trusted, never text a model can write: Claude Code's
 * tool name, OpenCode's permission name, and the server an MCP elicitation came from. Codex's
 * approval reason is the model's own explanation, so it is never matched.
 */
export function preapprovedTool(
  engine: string,
  server: string,
  method: string,
  params: Record<string, unknown>,
): boolean {
  if (method === "mcpServer/elicitation/request") return params["serverName"] === server;
  if (method !== "item/commandExecution/requestApproval") return false;
  const name = params["reason"];
  if (typeof name !== "string") return false;
  if (engine === "claude") return name.startsWith(`mcp__${server}__`);
  if (engine === "opencode") return name.startsWith(`${server}_`);
  return false;
}
