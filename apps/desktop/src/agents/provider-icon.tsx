import { Bot } from "lucide-react";
import type { AgentProviderId } from "@concors/protocol";
import { CodexIcon } from "./paseo/codex-icon";
import { ClaudeIcon } from "./paseo/claude-icon";
import { OpenCodeIcon } from "./paseo/opencode-icon";
export function ProviderIcon({ provider }: { provider: AgentProviderId }) {
  if (provider === "codex") return <CodexIcon />;
  if (provider === "claude") return <ClaudeIcon />;
  if (provider === "opencode") return <OpenCodeIcon />;
  if (provider === "copilot") return <Bot className="size-4" aria-hidden="true" />;
  if (provider !== "pi" && provider !== "omp") return <Bot className="size-4" aria-hidden="true" />;
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center font-mono text-base"
    >
      π
    </span>
  );
}
