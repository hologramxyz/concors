import { ProviderRegistry } from "./registry.ts";
import { AcpProvider } from "./acp.ts";
import type { AgentProviderId, McpServer } from "@concors/protocol";
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
export function providerFactory(registry: ProviderRegistry): AgentProviderFactory {
  return (cwd, onInput, provider = "codex", tools = {}) => {
    const original = registry.config(provider);
    const config = {
      ...original,
      params: {
        ...original.params,
        mcpServers: [
          ...(original.params?.mcpServers ?? []).filter(
            (s) => !tools.mcp || s.name !== "concors-schedules",
          ),
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
          config.env?.["CLAUDE_CONFIG_DIR"],
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
