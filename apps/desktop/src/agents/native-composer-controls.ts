import { modelMenu, modelOptions, type NativeControl } from "@concors/client-core";
import {
  agentProviderName,
  type AgentAccount,
  type AgentInfo,
  type AgentSettings,
  type ProviderVersion,
} from "@concors/protocol";
import { codexPermissionModes, effortName, hasComposerOptions } from "./composer-options";
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
  serviceTiers?:
    readonly { id: string; label: string; description?: string | undefined }[] | undefined;
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
  return rows.map((row, index) => (index ? row : { ...row, section: true }));
}

/** The model button's sheet: the page provider's models, and the pages its rows open. */
function modelControls({
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
}): [NativeControl, ...NativeControl[]] {
  const engine = agent.engine ?? agent.provider;
  const icon: NativeControl["icon"] =
    providerIcons[page?.id === agent.provider ? engine : (page?.id ?? agent.provider)] ?? "options";
  const base = { icon, disabled };
  const current = page?.id === agent.provider;
  const menu = page ? modelMenu(current ? selection.options : modelOptions(page.models)) : [];
  const row = (model: (typeof menu)[number]): Option => ({
    id: model.id,
    label: model.label,
    selected: current && selection.value === model.id,
  });
  const older = menu.filter((model) => model.older);
  const pageName = page
    ? providerName(page)
    : (agent.providerLabel ?? agentProviderName(agent.provider));
  const olderChosen = older.find((model) => row(model).selected);
  return [
    {
      ...base,
      id: "model",
      label: "Agent and model",
      title: pageName,
      options: [
        // An empty catalog must still allow opening a provider to sign in, and a missing CLI to be
        // installed: the chat it opens offers the install.
        ...(page && !page.models.length
          ? [
              {
                id: "",
                label: `${page.installed === false ? "Install" : "Use"} ${pageName}`,
                selected: false,
              },
            ]
          : []),
        ...menu.filter((model) => !model.older).map(row),
        ...(older.length
          ? [
              {
                id: "model:older",
                label: "Older models",
                selected: false,
                navigate: true,
                ...(olderChosen ? { value: olderChosen.label } : {}),
              },
            ]
          : []),
        ...footer,
        {
          id: "model:providers",
          label: "Provider",
          value: pageName,
          selected: false,
          navigate: true,
          section: true,
        },
      ],
    },
    ...(older.length
      ? [
          {
            ...base,
            id: "model:older",
            label: "Older models",
            title: "Older models",
            // Switching to another provider asks first, in a dialog this sheet would cover.
            options: older.map((model) => ({
              ...row(model),
              ...(current ? {} : { closes: true }),
            })),
          },
        ]
      : []),
    {
      ...base,
      id: "model:providers",
      label: "Provider",
      title: "Providers",
      options: providers
        .filter((provider) => !provider.error || provider.models.length)
        .map((provider) => {
          const description = providerState(provider);
          return {
            id: provider.id,
            label: providerName(provider),
            selected: provider.id === agent.provider,
            ...(description ? { description } : {}),
          };
        }),
    },
  ];
}

/** A row of the options sheet that opens a page, with what that page is set to beside its label. */
const opens = (
  control: { id: string; label: string; options: readonly Option[] },
  value = control.options.find((option) => option.selected)?.label,
): Option => ({
  id: control.id,
  label: control.label,
  selected: false,
  navigate: true,
  ...(value ? { value } : {}),
});

/**
 * Everything the native toolbar's Model and Options buttons open, worded as the desktop menus are.
 * Only those two controls sit in the toolbar. The others are pages of their sheets. The options
 * sheet lists its choices first and its switches in a group below them.
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
  const choices: Option[] = [];
  const switches: Option[] = [];
  if (effortModel?.efforts.length)
    choices.push(
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
  if (codex)
    choices.push(
      opens(
        addPage(
          "mode",
          "Permission mode",
          "shield",
          codexPermissionModes.map((mode) => ({ ...mode, selected: settings.mode === mode.id })),
        ),
      ),
    );
  else if (agent.controls?.modes.length)
    choices.push(
      opens(
        addPage(
          "mode",
          "Agent mode",
          "shield",
          agent.controls.modes.map((mode) => ({
            id: mode.id,
            label: mode.label,
            selected: nativeMode === mode.id,
            ...(mode.description ? { description: mode.description } : {}),
          })),
        ),
      ),
    );
  if (codex && effortModel?.serviceTiers?.length) {
    const tiers = effortModel.serviceTiers;
    choices.push(
      opens(
        addPage("speed", "Speed", "options", [
          { id: "speed:", label: "Default speed", selected: !settings.serviceTier },
          ...tiers.map((tier) => ({
            id: `speed:${tier.id}`,
            label: tier.label,
            selected: settings.serviceTier === tier.id,
            ...(tier.description ? { description: tier.description } : {}),
          })),
        ]),
        tiers.find((tier) => tier.id === settings.serviceTier)?.label ?? "Default",
      ),
    );
  }
  if (agent.supportsPlan)
    switches.push({ id: "plan", label: "Plan mode", selected: !!settings.planMode, toggle: true });
  for (const feature of agent.controls?.features ?? []) {
    const value = settings.features?.[feature.id] ?? feature.value;
    if (feature.options)
      choices.push(
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
      switches.push({
        id: `feature:${JSON.stringify([feature.id, !value])}`,
        label: feature.id === "fast_mode" ? "Fast" : feature.label,
        selected: !!value,
        toggle: true,
      });
  }
  const rows = [
    ...choices,
    ...switches.map((row, index) => (index ? row : { ...row, section: true })),
  ];
  const [model, ...modelPages] = modelControls({
    agent,
    disabled: modelDisabled,
    providers,
    page,
    selection,
    footer,
  });
  return [
    model,
    ...(hasComposerOptions(agent, effortModel) && rows.length
      ? [
          {
            id: "options",
            label: "More composer options",
            title: "Options",
            icon: "options" as const,
            disabled,
            options: rows,
          },
        ]
      : []),
    ...modelPages,
    ...pages,
  ];
}
