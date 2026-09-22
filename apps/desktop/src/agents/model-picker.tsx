import { modelOptions } from "@concors/client-core";
import { LoaderCircle } from "lucide-react";
import { agentProviderName, type AgentInfo } from "@concors/protocol";
import { ControlPicker } from "./control-picker";
import { ProviderIcon } from "./provider-icon";
import { useAgentModelSelection } from "./use-model-selection";
import { ProviderUpdateNotice } from "./provider-update";

export function AgentModelPicker({
  agent,
  disabled,
  onSelect,
  showValue = true,
}: {
  agent: AgentInfo;
  disabled: boolean;
  showValue?: boolean;
  onSelect: (model: string | null) => void;
}) {
  const { selection, providers, load, choose, switching, error } = useAgentModelSelection(
    agent,
    onSelect,
    !disabled && agent.status !== "starting",
  );
  const currentUpdate = providers.find((p) => p.id === agent.provider)?.version;
  return (
    <>
      <ControlPicker
        label="Agent and model"
        showValue={showValue}
        selectedLabel={selection.label}
        value={selection.value}
        icon={
          agent.status === "starting" || switching ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <span className="relative inline-flex">
              <ProviderIcon provider={agent.provider} />
              {currentUpdate?.updateAvailable && (
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-background"
                />
              )}
            </span>
          )
        }
        disabled={disabled || agent.status === "starting" || switching}
        options={[]}
        selectedGroupId={agent.provider}
        onOpen={() => void load()}
        onGroupChange={(id) => void load(id)}
        groups={providers.map((p) => ({
          id: p.id,
          label: p.label ?? agentProviderName(p.id),
          description: `${p.id === agent.provider ? "Current conversation" : "Use in this pane"}${p.version?.updateAvailable ? ` · Update available (${p.version.latest})` : ""}`,
          icon: <ProviderIcon provider={p.id} />,
          emptyMessage:
            p.error ??
            (p.loaded
              ? "No models reported. Check this provider in Settings."
              : "Models are being discovered. They will appear here automatically."),
          status: p.error,
          footer: p.version && (
            <ProviderUpdateNotice
              provider={p.id}
              label={p.label ?? agentProviderName(p.id)}
              version={p.version}
            />
          ),
          options: [
            // An empty catalog must still allow opening a provider to sign in.
            ...(!p.models.length
              ? [
                  {
                    id: "",
                    label: `Use ${p.label ?? agentProviderName(p.id)}`,
                    icon: <ProviderIcon provider={p.id} />,
                  },
                ]
              : []),
            ...(p.id === agent.provider ? selection.options : modelOptions(p.models)).map((m) => ({
              id: m.id,
              label: m.label,
              icon: <ProviderIcon provider={p.id} />,
            })),
          ],
        }))}
        onSelect={(value, provider) => void choose(value, provider)}
      />
      {error && (
        <p role="alert" className="w-full px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
