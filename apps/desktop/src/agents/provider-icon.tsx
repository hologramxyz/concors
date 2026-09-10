import type { AgentProviderId } from "@concors/protocol";
import { CodexIcon } from "./paseo/codex-icon";
import { ClaudeIcon } from "./paseo/claude-icon";
import { OpenCodeIcon } from "./paseo/opencode-icon";
export function ProviderIcon({ provider }: { provider: AgentProviderId }) {
  if (provider === "codex") return <CodexIcon />;
  if (provider === "claude") return <ClaudeIcon />;
  if (provider === "opencode") return <OpenCodeIcon />;
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center font-mono text-base"
    >
      π
    </span>
  );
}
