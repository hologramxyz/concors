import type { AgentInfo } from "@concors/protocol";

/**
 * Whether the phone's options sheet would have anything in it, so its button can step aside when it
 * would not. Follows what the composer renders there: effort, a provider's own modes (Codex has
 * permissions instead), its features, and plan mode.
 */
export function hasComposerOptions(
  agent: Pick<AgentInfo, "provider" | "engine" | "controls" | "supportsPlan">,
  model: { efforts: readonly string[] } | null | undefined,
): boolean {
  return (
    (agent.engine ?? agent.provider) === "codex" ||
    !!model?.efforts.length ||
    !!agent.controls?.modes.length ||
    !!agent.controls?.features.length ||
    !!agent.supportsPlan
  );
}
