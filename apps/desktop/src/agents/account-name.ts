import { providerPresets } from "@concors/protocol";

/**
 * What someone signs into for a provider, which is not always the agent's own name: Codex runs on
 * a ChatGPT account and Claude Code on a Claude one. OpenCode takes a key from whichever model
 * provider it is set up for, so that is all that can be said of it. No other engine signs in
 * through Concors. A provider whose engine is not known here goes by its own label.
 */
export function accountName(engine: string | undefined, label: string) {
  if (engine === "codex") return "ChatGPT";
  if (engine === "claude") return "Claude";
  if (engine === "opencode") return "model provider";
  return label;
}

/** What a subscription added without a name is stored under; it says nothing worth repeating. */
export const UNNAMED_SUBSCRIPTION = "Account";

/** A model catalog does not say each provider's engine, but a built-in provider's ID settles it. */
export function presetEngine(providerId: string) {
  return providerPresets.find((preset) => preset.id === providerId)?.engine;
}
