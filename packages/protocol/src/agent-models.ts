import type { AgentInfo } from "./agents.ts";

type Model = NonNullable<AgentInfo["models"]>[number];
const generic = (value: string) =>
  /^(?:machine\s+)?default(?:\b|$)|^auto(?:matic)?$/i.test(value.trim());

/** Format only the identifier actually reported by the provider, never a pinned model list. */
export function modelName(id: string): string {
  const claude = /^claude-([a-z]+)-(\d+(?:[.-]\d+)*)(\[1m\])?$/i.exec(
    id.replace(/-\d{8}(?=\[|$)/, ""),
  );
  if (claude?.[1] && claude[2]) {
    const family = claude[1];
    return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${claude[2].replaceAll("-", ".")}${claude[3] ? " (1M context)" : ""}`;
  }
  return id;
}

export function agentModelName(model: Model, models: readonly Model[] = []): string {
  if (!generic(model.label) && !generic(model.id)) {
    // Some SDKs name aliases just "Opus"/"Sonnet" despite supplying the exact version.
    if (
      model.resolvedModel &&
      !/\b\d+(?:[.-]\d+)*\b/.test(model.label) &&
      modelName(model.resolvedModel) !== model.resolvedModel
    )
      return modelName(model.resolvedModel);
    return model.label;
  }
  const resolved = model.resolvedModel;
  if (resolved) {
    const named = models.find((m) => m.id === resolved && !generic(m.label));
    return named?.label ?? modelName(resolved);
  }
  return "Automatic";
}

export function findAgentModel(models: readonly Model[], selected: string | null | undefined) {
  return models.find((m) => m.id === selected) ?? models.find((m) => m.resolvedModel === selected);
}

export function agentModelSelection(agent: AgentInfo, models = agent.models ?? []) {
  const selected = agent.settings?.model ?? agent.model;
  const row =
    findAgentModel(models, selected) ?? (!selected ? models.find((m) => m.isDefault) : undefined);
  return {
    value: row?.id ?? selected ?? "",
    label:
      row && generic(row.id) && !row.resolvedModel && agent.model && !generic(agent.model)
        ? modelName(agent.model)
        : row
          ? agentModelName(row, models)
          : selected && !generic(selected)
            ? modelName(selected)
            : "Model not reported",
  };
}
