import { LoaderCircle } from "lucide-react";
import type { AgentInfo } from "@concors/protocol";
import { ControlPicker } from "./control-picker";
import { CodexIcon } from "./paseo/codex-icon";

export function AgentModelPicker({
  agent,
  disabled,
  onSelect,
}: {
  agent: AgentInfo;
  disabled: boolean;
  onSelect: (model: string | null) => void;
}) {
  const models = agent.models ?? [];
  const model = agent.settings?.model ?? agent.model;
  const options = [
    {
      id: "",
      label: "Machine default",
      description: agent.model ?? "Use this machine’s configured model",
      icon: <CodexIcon />,
    },
    ...models.map((item) => ({ id: item.id, label: item.label, icon: <CodexIcon /> })),
  ];
  return (
    <ControlPicker
      label="Agent and model"
      showValue
      selectedLabel={models.find((item) => item.id === model)?.label ?? model ?? "Machine default"}
      value={agent.settings?.model ?? ""}
      icon={
        agent.status === "starting" ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <CodexIcon />
        )
      }
      disabled={disabled || agent.status === "starting"}
      options={options}
      groups={[{ id: agent.provider, label: "Codex", icon: <CodexIcon />, options }]}
      selectedGroupId={agent.provider}
      onSelect={(next) => onSelect(next || null)}
    />
  );
}
