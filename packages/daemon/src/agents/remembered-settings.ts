/**
 * New chats on a machine start with the settings last chosen for their provider there: model,
 * thinking effort, approvals, speed, native mode and features. The daemon owns this memory, so it
 * is per machine and shared by every client connected to it.
 *
 * Plan mode is per conversation and is never carried over. A remembered choice the provider no
 * longer offers (a retired model, an effort the model lacks) is dropped rather than sent, because
 * the provider would reject the whole turn.
 */
import { findAgentModel, type AgentInfo, type AgentSettings } from "@concors/protocol";
import { defaultSettings } from "./controls.ts";

/** What is worth remembering from a user's choice. */
export function rememberable(settings: AgentSettings): AgentSettings {
  const { planMode: _planMode, ...rest } = settings;
  return rest;
}

/**
 * Settings for a new chat. An explicitly requested model wins over the remembered one and, like
 * picking a model in the composer, clears the choices that belonged to the previous model.
 */
export function initialSettings(
  remembered: AgentSettings | null,
  model: string | null = null,
): AgentSettings {
  if (!remembered) return { ...defaultSettings, model };
  const settings = { ...defaultSettings, ...rememberable(remembered) };
  return model && model !== remembered.model
    ? { ...settings, model, effort: null, serviceTier: null, features: {} }
    : settings;
}

/** Drops the parts of `settings` this session's provider cannot honour. */
export function supportedSettings(
  settings: AgentSettings,
  session: Pick<
    AgentInfo,
    "engine" | "provider" | "model" | "models" | "controls" | "supportsPlan"
  >,
): AgentSettings {
  const models = session.models ?? [];
  const next = { ...settings };
  if (next.model && models.length && !models.some((m) => m.id === next.model)) next.model = null;
  const model = findAgentModel(models, next.model ?? session.model);
  if (next.effort && model && !model.efforts.includes(next.effort)) next.effort = null;
  if (next.serviceTier && !model?.serviceTiers?.some((tier) => tier.id === next.serviceTier))
    next.serviceTier = null;
  if ((session.engine ?? session.provider) !== "codex") {
    next.mode = "default";
    next.serviceTier = null;
  }
  if (next.planMode && !session.supportsPlan) next.planMode = false;
  const controls = session.controls;
  if (next.nativeMode && !controls?.modes.some((m) => m.id === next.nativeMode))
    next.nativeMode = null;
  if (next.features) {
    const features = Object.entries(next.features).filter(([key, value]) => {
      const feature = controls?.features.find((f) => f.id === key);
      return feature?.options
        ? feature.options.some((o) => o.id === value)
        : !!feature && typeof value === "boolean";
    });
    next.features = Object.fromEntries(features);
  }
  return next;
}
