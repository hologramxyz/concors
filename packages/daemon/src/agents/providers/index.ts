import { ProviderRegistry } from "./registry.ts";
import { AcpProvider } from "./acp.ts";
import type { AgentProviderId, McpServer, ProviderConfig } from "@concors/protocol";
import { CodexAppServer } from "../codex/app-server.ts";
import { ClaudeProvider } from "./claude.ts";
import { OpenCodeProvider } from "./opencode.ts";
import { PiProvider } from "./pi.ts";
import type { ConversationProvider, InputHandler } from "./contract.ts";
export interface AgentToolContext {
  mcp?: McpServer;
  env?: NodeJS.ProcessEnv;
  instructions?: string;
}
export type AgentProviderFactory = (
  cwd: string,
  onInput: InputHandler,
  provider?: AgentProviderId,
  tools?: AgentToolContext,
) => ConversationProvider;
/**
 * Whether an agent can load a machine-wide MCP server. Pi manages MCP itself, a provider may opt
 * out, and Codex speaks HTTP and stdio but not SSE; those simply go without that server.
 */
export function usesMcpServer(config: ProviderConfig, server: McpServer): boolean {
  if (["pi", "omp"].includes(config.engine)) return false;
  if (config.params?.supportsMcpServers === false) return false;
  return !(config.engine === "codex" && server.type === "sse");
}
export function providerFactory(registry: ProviderRegistry): AgentProviderFactory {
  return (cwd, onInput, provider = "codex", tools = {}) => {
    const original = registry.config(provider);
    const own = (original.params?.mcpServers ?? []).filter(
      (s) => !tools.mcp || s.name !== "concors-schedules",
    );
    const config = {
      ...original,
      params: {
        ...original.params,
        // The machine's servers, those set for this provider (which win on a name), then Concors's.
        mcpServers: [
          ...registry
            .mcpServers()
            .filter(
              (server) =>
                usesMcpServer(original, server) && !own.some((s) => s.name === server.name),
            ),
          ...own,
          ...(tools.mcp ? [tools.mcp] : []),
        ],
      },
    };
    const baseLaunch = registry.launcher(config);
    const launch: typeof baseLaunch = (command, args, directory, env) =>
      baseLaunch(command, args, directory, { ...env, ...tools.env });
    switch (config.engine) {
      case "claude":
        return new ClaudeProvider(
          cwd,
          onInput,
          undefined,
          launch,
          registry.credentialDir(config),
          config.params?.mcpServers,
        );
      case "opencode":
        return new OpenCodeProvider(cwd, onInput, launch, config.params?.mcpServers);
      case "pi":
      case "omp":
        return new PiProvider(cwd, onInput, launch, config.engine, {
          ...process.env,
          ...config.env,
          ...tools.env,
        });
      case "acp":
        return new AcpProvider(cwd, onInput, config, launch);
      case "codex":
        return new CodexAppServer(
          launch("codex", ["app-server", "--listen", "stdio://"], cwd),
          onInput,
          config.params?.mcpServers,
        );
    }
  };
}
export const createProvider: AgentProviderFactory = (cwd, onInput, provider, tools) =>
  providerFactory(new ProviderRegistry())(cwd, onInput, provider, tools);
