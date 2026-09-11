import { LoaderCircle } from "lucide-react";
import {
  agentProviderName,
  agentModelName,
  agentModelSelection,
  type AgentInfo,
} from "@concors/protocol";
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
  const { currentModels, providers, load, choose, loadingProvider, switching, error } =
    useAgentModelSelection(agent, onSelect, !disabled && agent.status !== "starting");
  const selected = agentModelSelection(agent, currentModels);
  return (
    <>
      <ControlPicker
        label="Agent and model"
        showValue={showValue}
        selectedLabel={selected.label}
        value={selected.value}
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
          emptyMessage: p.error ?? "No models reported. Check this provider in Settings.",
          status: loadingProvider === p.id && !p.models.length ? "Loading models…" : p.error,
          options: [
            // Keep provider switching/sign-in possible when an older or signed-out
            // provider cannot report models yet; never invent a concrete model.
            ...(!p.models.length
              ? [
                  {
                    id: "",
                    label: `Use ${p.label ?? agentProviderName(p.id)}`,
                    description: "Let this provider choose the model",
                    icon: <ProviderIcon provider={p.id} />,
                  },
                ]
              : []),
            ...p.models.map((m) => ({
              id: m.id,
              label: agentModelName(m, p.models),
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
