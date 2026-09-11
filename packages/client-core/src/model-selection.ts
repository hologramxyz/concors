import type { AgentInfo } from "@concors/protocol";

type Model = NonNullable<AgentInfo["models"]>[number];
const ambiguous = /^(?:machine default|default(?: \(recommended\))?)$/i;

/** Resolve version labels from provider metadata, never a hardcoded model inventory. */
export function modelLabel(model: Model): string {
  const resolved = model.resolvedModel ?? model.id;
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(resolved);
  if (claude?.[1] && claude[2]) {
    const family = claude[1];
    const version = claude[2] + (claude[3] ? `.${claude[3]}` : "");
    // Preserve custom deployment names and special routing modes such as Opus Plan.
    if (
      model.label === model.id ||
      ambiguous.test(model.label) ||
      new RegExp(`^${family}(?: \\(1M context\\))?$`, "i").test(model.label)
    )
      return `${family.slice(0, 1).toUpperCase()}${family.slice(1)} ${version}${resolved.endsWith("[1m]") || model.id.endsWith("[1m]") ? " (1M context)" : ""}`;
  }
  return ambiguous.test(model.label)
    ? (model.resolvedModel ?? "Provider recommendation")
    : model.label;
}

export function modelOptions(models: readonly Model[]): Model[] {
  return (
    models
      // The SDK's default alias often duplicates the exact same explicit model option.
      .filter(
        (model) =>
          !(
            model.isDefault &&
            model.resolvedModel &&
            models.some(
              (other) =>
                !other.isDefault && (other.resolvedModel ?? other.id) === model.resolvedModel,
            )
          ),
      )
      .map((model) => ({ ...model, label: modelLabel(model) }))
  );
}

export function modelSelection(
  agent: Pick<AgentInfo, "settings" | "model">,
  models: readonly Model[],
) {
  const requested = agent.settings?.model ?? agent.model;
  const source =
    models.find((model) => model.id === requested) ??
    models.find((model) => model.resolvedModel === requested) ??
    (!requested ? models.find((model) => model.isDefault) : undefined);
  const options = modelOptions(models);
  const selected =
    source &&
    (options.find((model) => model.id === source.id) ??
      options.find((model) => (model.resolvedModel ?? model.id) === source.resolvedModel));
  if (selected) return { options, value: selected.id, label: selected.label };
  if (requested && !ambiguous.test(requested)) {
    const current: Model = { id: requested, label: requested, efforts: [], defaultEffort: null };
    current.label = modelLabel(current);
    return { options: [current, ...options], value: requested, label: current.label };
  }
  return { options, value: "", label: "Select model" };
}
