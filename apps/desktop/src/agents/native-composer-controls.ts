import { modelMenu, modelOptions, type NativeControl } from "@concors/client-core";
import {
  agentProviderName,
  type AgentAccount,
  type AgentInfo,
  type AgentSettings,
  type ProviderVersion,
} from "@concors/protocol";
import { effortName, hasComposerOptions } from "./composer-options";
import { providerState } from "./provider-switch";
import { providerUpdatePending } from "./provider-update-state";

type Option = NonNullable<NativeControl["options"]>[number];
type Model = Parameters<typeof modelOptions>[0][number];
interface Provider {
  id: string;
  label?: string | undefined;
  error?: string | null | undefined;
  installed?: boolean | undefined;
  version?: ProviderVersion | undefined;
  models: readonly Model[];
}
interface EffortModel {
  efforts: readonly string[];
  defaultEffort?: string | null | undefined;
  serviceTiers?: readonly { id: string; label: string }[] | undefined;
}

const providerIcons: Record<string, "model" | "claude" | "opencode" | "pi"> = {
  codex: "model",
  claude: "claude",
  opencode: "opencode",
  pi: "pi",
};
const providerName = (provider: Provider) => provider.label ?? agentProviderName(provider.id);

/** The rows under a provider's models, saying what the desktop menu's footers say. */
export function modelMenuFooter({
  provider,
  version,
  error,
  guide,
  account,
  accountName,
}: {
  provider: Provider;
  version: ProviderVersion | undefined;
  error: string | null | undefined;
  /** The vendor's guide, for a CLI the machine has no update command for. */
  guide: string | undefined;
  account: AgentAccount | undefined;
  accountName: string;
}): Option[] {
  const label = providerName(provider);
  const rows: Option[] = [];
  if (providerUpdatePending(version)) {
    const canUpdate = !!version?.updateAvailable && (!!version.updateCommand || !!guide);
    const manual = version?.updateAvailable && !version.updateCommand && !guide;
    const description = error ?? (manual ? "Update it the way you installed it." : undefined);
    rows.push({
      id: "__update__",
      label: version?.updating
        ? `Updating ${label}…`
        : version?.latest
          ? `Update to ${version.latest}`
          : `${label} has an update`,
      selected: false,
      // The menu stays open to show the update's progress, as the desktop one does.
      navigate: true,
      disabled: !canUpdate || !!version?.updating,
      ...(description ? { description } : {}),
    });
  }
  if (
    provider.installed !== false &&
    (account?.status === "disconnected" || account?.status === "pending")
  )
    rows.push({ id: "__connect__", label: `Connect ${accountName} account`, selected: false });
  return rows.map((row, index) => (index ? row : { ...row, divider: true }));
}

function modelControl({
  agent,
  disabled,
  providers,
  page,
  selection,
  footer,
}: {
  agent: AgentInfo;
  disabled: boolean;
  providers: readonly Provider[];
  page: Provider | undefined;
  selection: { value: string; options: readonly Model[] };
  footer: readonly Option[];
}): NativeControl {
  const engine = agent.engine ?? agent.provider;
  const icon: NativeControl["icon"] =
    providerIcons[page?.id === agent.provider ? engine : (page?.id ?? agent.provider)] ?? "options";
  const base = { id: "model", label: "Agent and model", icon, disabled };
  if (!page)
    return {
      ...base,
      title: "Providers",
      options: providers
        .filter((provider) => !provider.error || provider.models.length)
        .map((provider) => {
          const description = providerState(provider);
          return {
            id: provider.id,
            label: providerName(provider),
            selected: provider.id === agent.provider,
            navigate: true,
            ...(description ? { description } : {}),
          };
        }),
    };
  const models = modelMenu(
    page.id === agent.provider ? selection.options : modelOptions(page.models),
  );
  return {
    ...base,
    title: providerName(page),
    options: [
      { id: "__providers__", label: "← Providers", selected: false, navigate: true },
      // An empty catalog must still allow opening a provider to sign in, and a missing CLI to be
      // installed: the chat it opens offers the install.
      ...(!page.models.length
        ? [
            {
              id: "",
              label: `${page.installed === false ? "Install" : "Use"} ${providerName(page)}`,
              selected: false,
            },
          ]
        : []),
      ...models.map((model, index) => ({
        id: model.id,
        label: model.label,
        selected: page.id === agent.provider && selection.value === model.id,
        ...(model.older && index > 0 && !models[index - 1]?.older ? { divider: true } : {}),
      })),
      ...footer,
    ],
  };
}

/** A row of the options sheet that opens the control with the same ID. */
const opens = (control: { id: string; label: string }): Option => ({
  id: control.id,
  label: control.label,
  selected: false,
  navigate: true,
});

/**
 * Everything the native toolbar's Model and Options buttons open, worded as the desktop menus are.
 * Only those two controls sit in the toolbar. The others are pages of the options sheet, which
 * lists them in the order the phone web build's options sheet does.
 */
export function nativeComposerControls({
  agent,
  settings,
  effortModel,
  disabled,
  modelDisabled,
  providers,
  page,
  selection,
  footer,
}: {
  agent: AgentInfo;
  settings: AgentSettings;
  effortModel: EffortModel | null | undefined;
  disabled: boolean;
  modelDisabled: boolean;
  providers: readonly Provider[];
  page: Provider | undefined;
  selection: { value: string; options: readonly Model[] };
  footer: readonly Option[];
}): NativeControl[] {
  const codex = (agent.engine ?? agent.provider) === "codex";
  const nativeMode = settings.nativeMode ?? agent.controls?.currentMode;
  const pages: NativeControl[] = [];
  const addPage = (id: string, label: string, icon: NativeControl["icon"], options: Option[]) => {
    const control = { id, label, title: label, icon, disabled, options };
    pages.push(control);
    return control;
  };
  const rows: Option[] = [];
  if (effortModel?.efforts.length)
    rows.push(
      opens(
        addPage("effort", "Thinking effort", "brain", [
          {
            id: "",
            label: `Default (${effortModel.defaultEffort ?? "automatic"})`,
            selected: !settings.effort,
          },
          ...effortModel.efforts.map((effort) => ({
            id: effort,
            label: effortName(effort),
            selected: settings.effort === effort,
          })),
        ]),
      ),
    );
  if (!codex && agent.controls?.modes.length)
    rows.push(
      opens(
        addPage(
          "mode",
          "Agent mode",
          "shield",
          agent.controls.modes.map((mode) => ({
            id: mode.id,
            label: mode.label,
            selected: nativeMode === mode.id,
          })),
        ),
      ),
    );
  for (const feature of agent.controls?.features ?? []) {
    const value = settings.features?.[feature.id] ?? feature.value;
    if (feature.options)
      rows.push(
        opens(
          addPage(
            `feature:${feature.id}`,
            feature.label,
            "options",
            feature.options.map((option) => ({
              id: `feature:${JSON.stringify([feature.id, option.id])}`,
              label: option.label,
              selected: value === option.id,
            })),
          ),
        ),
      );
    else
      rows.push({
        id: `feature:${JSON.stringify([feature.id, !value])}`,
        label: feature.id === "fast_mode" ? "Fast" : feature.label,
        selected: !!value,
      });
  }
  if (codex)
    rows.push(
      opens(
        addPage("mode", "Permission mode", "shield", [
          { id: "default", label: "Default permissions", selected: settings.mode === "default" },
          { id: "auto-review", label: "Auto-review", selected: settings.mode === "auto-review" },
          { id: "full-access", label: "Full access", selected: settings.mode === "full-access" },
        ]),
      ),
    );
  if (agent.supportsPlan)
    rows.push({ id: "plan", label: "Plan mode", selected: !!settings.planMode });
  // Choosing the tier that is on goes back to the default speed.
  if (codex)
    for (const tier of effortModel?.serviceTiers ?? []) {
      const on = settings.serviceTier === tier.id;
      rows.push({ id: `speed:${on ? "" : tier.id}`, label: tier.label, selected: on });
    }
  return [
    modelControl({ agent, disabled: modelDisabled, providers, page, selection, footer }),
    ...(hasComposerOptions(agent, effortModel) && rows.length
      ? [
          {
            id: "options",
            label: "More composer options",
            icon: "options" as const,
            disabled,
            options: rows,
          },
        ]
      : []),
    ...pages,
  ];
}
