import { ProviderRegistry } from "./registry.ts";
import { AcpProvider } from "./acp.ts";
import type { AgentProviderId } from "@concors/protocol";
import { CodexAppServer } from "../codex/app-server.ts";
import { ClaudeProvider } from "./claude.ts";
import { OpenCodeProvider } from "./opencode.ts";
import { PiProvider } from "./pi.ts";
import type { ConversationProvider, InputHandler } from "./contract.ts";
export type AgentProviderFactory = (
  cwd: string,
  onInput: InputHandler,
  provider?: AgentProviderId,
) => ConversationProvider;
export function providerFactory(registry: ProviderRegistry): AgentProviderFactory {
  return (cwd, onInput, provider = "codex") => {
    const config = registry.config(provider),
      launch = registry.launcher(config);
    switch (config.engine) {
      case "claude":
        return new ClaudeProvider(cwd, onInput, undefined, launch);
      case "opencode":
        return new OpenCodeProvider(cwd, onInput, launch);
      case "pi":
      case "omp":
        return new PiProvider(cwd, onInput, launch, config.engine);
      case "acp":
        return new AcpProvider(cwd, onInput, config, launch);
      case "codex":
        return new CodexAppServer(
          launch("codex", ["app-server", "--listen", "stdio://"], cwd),
          onInput,
        );
    }
  };
}
export const createProvider: AgentProviderFactory = (cwd, onInput, provider) =>
  providerFactory(new ProviderRegistry())(cwd, onInput, provider);
