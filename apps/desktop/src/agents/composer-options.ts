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

/** An effort as a reasoning level is named in the menus; the catalog gives it as a raw ID. */
export function effortName(effort: string): string {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

/** Codex's permission modes, as both the desktop menu and the iPhone's sheet word them. */
export const codexPermissionModes = [
  {
    id: "default",
    label: "Default permissions",
    description: "Workspace access; asks when approval is needed.",
  },
  {
    id: "auto-review",
    label: "Auto-review",
    description: "Same sandbox; eligible requests go to the reviewer agent.",
  },
  {
    id: "full-access",
    label: "Full access",
    description: "File and network access without approval prompts.",
  },
] as const;
