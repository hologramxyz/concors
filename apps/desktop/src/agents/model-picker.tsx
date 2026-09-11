import { modelOptions } from "@concors/client-core";
import { LoaderCircle } from "lucide-react";
import { agentProviderName, type AgentInfo } from "@concors/protocol";
import { ControlPicker } from "./control-picker";
import { ProviderIcon } from "./provider-icon";
import { useAgentModelSelection } from "./use-model-selection";

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
  );
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
            <ProviderIcon provider={agent.provider} />
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
          description: p.id === agent.provider ? "Current conversation" : "Starts a new chat",
          icon: <ProviderIcon provider={p.id} />,
          emptyMessage:
            p.error ?? "Models are being discovered. They will appear here automatically.",
          options: (p.id === agent.provider ? selection.options : modelOptions(p.models)).map(
            (m) => ({
              id: m.id,
              label: m.label,
              icon: <ProviderIcon provider={p.id} />,
            }),
          ),
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
