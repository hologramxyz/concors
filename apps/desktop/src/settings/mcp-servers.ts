import type { McpServerInput, McpServerSummary } from "@concors/protocol";

/** The names of a server's secrets: its env variables, or its headers. */
export function secretKeys(server: McpServerSummary): string[] {
  return server.type === "stdio" ? server.envKeys : server.headerKeys;
}

/** A saved server sent back unchanged: each secret null, so the machine keeps its stored value. */
export function mcpServerInput(server: McpServerSummary): McpServerInput {
  const kept = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, null]));
  return server.type === "stdio"
    ? {
        name: server.name,
        type: "stdio",
        command: server.command,
        args: server.args,
        env: kept(server.envKeys),
      }
    : { name: server.name, type: server.type, url: server.url, headers: kept(server.headerKeys) };
}
