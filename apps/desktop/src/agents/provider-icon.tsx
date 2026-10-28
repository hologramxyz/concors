import { Bot } from "lucide-react";
import type { AgentProviderId } from "@concors/protocol";
import { CodexIcon } from "./paseo/codex-icon";
import { ClaudeIcon } from "./paseo/claude-icon";
import { OpenCodeIcon } from "./paseo/opencode-icon";
/** `size` in pixels, for the few places that show the mark larger than its 16px default. */
export function ProviderIcon({
  provider,
  size = 16,
}: {
  provider: AgentProviderId;
  size?: number;
}) {
  if (provider === "codex") return <CodexIcon size={size} />;
  if (provider === "claude") return <ClaudeIcon size={size} />;
  if (provider === "opencode") return <OpenCodeIcon size={size} />;
  if (provider !== "pi" && provider !== "omp") return <Bot size={size} aria-hidden="true" />;
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center font-mono text-base"
    >
      π
    </span>
  );
}
