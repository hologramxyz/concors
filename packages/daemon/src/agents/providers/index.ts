import type { AgentProviderId } from "@concors/protocol";
import { CodexAppServer } from "../codex/app-server.ts";
import { ClaudeProvider } from "./claude.ts";
import { OpenCodeProvider } from "./opencode.ts";
import { PiProvider } from "./pi.ts";
import { launch } from "./launch.ts";
import type { ConversationProvider, InputHandler } from "./contract.ts";
export type AgentProviderFactory = (
  cwd: string,
  onInput: InputHandler,
  provider?: AgentProviderId,
) => ConversationProvider;
export const createProvider: AgentProviderFactory = (cwd, onInput, provider = "codex") => {
  switch (provider) {
    case "claude":
      return new ClaudeProvider(cwd, onInput);
    case "opencode":
      return new OpenCodeProvider(cwd, onInput);
    case "pi":
      return new PiProvider(cwd, onInput);
    case "codex":
      return new CodexAppServer(
        launch("codex", ["app-server", "--listen", "stdio://"], cwd),
        onInput,
      );
  }
};
